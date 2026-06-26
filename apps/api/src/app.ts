import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import * as Sentry from '@sentry/hono/cloudflare';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { and, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import { getDb, getLibsql } from './db/client';
import {
  branch,
  ingredientCategory,
  ingredientItem,
  ingredientLine,
  ingredientRecord,
  ingredientUnitOption,
  loginAttempt,
  operationCheck,
  operationRecord,
  productItem,
  productLine,
  productRecord,
} from './db/schema';
import { env } from './env';
import { checklistPages } from './operationTemplates';

type Domain =
  | 'AUTH'
  | 'BRANCH'
  | 'OPERATION'
  | 'INGREDIENT_CHECKLIST'
  | 'PRODUCT_CHECKLIST'
  | 'INGREDIENT_SETTINGS'
  | 'PRODUCT_SETTINGS'
  | 'SYSTEM'
  | 'STATS';

type Operation = 'LOGIN' | 'LOAD' | 'SAVE' | 'CREATE' | 'UPDATE' | 'DELETE' | 'REORDER';

type AppBindings = {
  SENTRY_DSN?: string;
  DISCORD_WEBHOOK_URL?: string;
  CF_ANALYTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  OPS_MIN_ACTIVITY_HOURS?: string;
  APP_ENV?: string;
};

type AppVariables = {
  requestId: string;
};

const app = new Hono<{ Bindings: AppBindings; Variables: AppVariables }>();
const tokenSecret = new TextEncoder().encode(env.AUTH_TOKEN_SECRET!);
const verdicts = new Set(['정상', '과다', '부족']);
const productUnits = new Set(['박스', '봉', '묶음', '줄', '짝', '개', '통']);
const operationTemplates = checklistPages.map((page) => ({
  checklistId: page.id,
  phase: page.phase,
  name: page.title,
  sections: page.sections.map((section, sectionIndex) => ({
    name: section.title,
    items: section.items.map((label, itemIndex) => ({
      itemKey: `c${page.id}-s${sectionIndex}-i${itemIndex}`,
      label,
    })),
  })),
}));
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
const LOGIN_BLOCK_MS = 5 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 5;

function requestId() {
  return `req_${new Date().toISOString().slice(0, 10)}_${crypto.randomUUID().slice(0, 8)}`;
}

function getRequestId(c: any) {
  return c.get?.('requestId') || requestId();
}

function apiError(
  c: any,
  status: number,
  code: string,
  domain: Domain,
  operation: Operation,
  message: string,
  field: string | null = null,
  details: Record<string, unknown> | null = null,
) {
  const id = getRequestId(c);
  console.error({
    event: 'api_error',
    requestId: id,
    domain,
    operation,
    code,
    status,
    message,
  });
  if (status >= 500) {
    Sentry.withScope((scope) => {
      scope.setTag('requestId', id);
      scope.setTag('domain', domain);
      scope.setTag('operation', operation);
      scope.setContext('api_error', { code, status, field, details });
      Sentry.captureException(new Error(`${domain}.${operation} ${code}: ${message}`));
    });
  }
  return c.json(
    {
      error: {
        code,
        domain,
        operation,
        message,
        requestId: id,
        timestamp: new Date().toISOString(),
        field,
        details,
      },
    },
    status,
  );
}

function toNumber(value: unknown) {
  if (value === '' || value === undefined || value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function parseFiniteNumber(value: unknown) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function monthFromQuery(value: string | undefined) {
  if (!value || !/^\d{4}-\d{2}$/.test(value)) return null;
  const monthIndex = Number(value.slice(5, 7));
  if (monthIndex < 1 || monthIndex > 12) return null;
  return value;
}

function addMonths(month: string, delta: number) {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + delta, 1));
  return date.toISOString().slice(0, 7);
}

function monthStart(month: string) {
  return `${month}-01`;
}

function monthEnd(month: string) {
  const date = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0));
  return date.toISOString().slice(0, 10);
}

function addDays(dateValue: string, delta: number) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function monthsBetween(startMonth: string, endMonth: string) {
  const months: string[] = [];
  let current = startMonth;
  while (current <= endMonth) {
    months.push(current);
    current = addMonths(current, 1);
  }
  return months;
}

function roundMetric(value: number | null | undefined, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return 0;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function isUniqueConstraintError(error: unknown) {
  const text = `${(error as { code?: string; message?: string })?.code ?? ''} ${(error as { code?: string; message?: string })?.message ?? ''}`;
  return text.includes('SQLITE_CONSTRAINT') || text.includes('UNIQUE constraint failed');
}

function clientKey(c: any) {
  return (c.req.header('x-forwarded-for') || c.req.header('cf-connecting-ip') || c.req.header('x-real-ip') || 'local').split(',')[0].trim();
}

async function isLoginBlocked(key: string) {
  const [attempt] = await getDb().select().from(loginAttempt).where(eq(loginAttempt.loginKey, key)).limit(1);
  return Boolean(attempt && attempt.blockedUntil > Date.now());
}

async function recordFailedLogin(key: string) {
  const now = Date.now();
  await getDb().transaction(async (tx) => {
    const [current] = await tx.select().from(loginAttempt).where(eq(loginAttempt.loginKey, key)).limit(1);
    const firstAt = !current || now - current.firstAt > LOGIN_WINDOW_MS ? now : current.firstAt;
    const count = !current || now - current.firstAt > LOGIN_WINDOW_MS ? 1 : current.count + 1;
    const blockedUntil = count >= LOGIN_MAX_ATTEMPTS ? now + LOGIN_BLOCK_MS : 0;
    if (current) {
      await tx.update(loginAttempt).set({ count, firstAt, blockedUntil, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(loginAttempt.loginKey, key));
      return;
    }
    await tx.insert(loginAttempt).values({ loginKey: key, count, firstAt, blockedUntil });
  });
}

async function clearLoginAttempts(key: string) {
  await getDb().delete(loginAttempt).where(eq(loginAttempt.loginKey, key));
}

function toText(value: unknown) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text === '' ? null : text;
}

function parseManagers(value: string | null, managerName?: string | null, managerPosition?: string | null) {
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parsed
          .slice(0, 3)
          .map((manager) => ({
            position: toText(manager?.position),
            name: toText(manager?.name) || '',
          }));
      }
    } catch {
      // Fall back to legacy columns below.
    }
  }
  if (managerName || managerPosition) return [{ position: toText(managerPosition), name: managerName || '' }];
  return [];
}

function normalizeManagers(input: unknown, managerName?: unknown, managerPosition?: unknown) {
  if (Array.isArray(input)) {
    return input.slice(0, 3).map((manager) => ({
      position: toText(manager?.position),
      name: toText(manager?.name) || '',
    }));
  }
  return parseManagers(null, toText(managerName), toText(managerPosition));
}

async function createToken() {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const token = await new SignJWT({ scope: 'shinkal' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(tokenSecret);
  return { token, expiresAt: expiresAt.toISOString() };
}

async function requireAuth(c: any, next: any) {
  const header = c.req.header('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : null;
  const cookieToken = getCookie(c, 'shinkal_token');
  const token = bearer || cookieToken;
  if (!token) return apiError(c, 401, 'UNAUTHORIZED', 'AUTH', 'LOAD', '로그인이 필요합니다.');
  try {
    await jwtVerify(token, tokenSecret);
    return next();
  } catch {
    return apiError(c, 401, 'UNAUTHORIZED', 'AUTH', 'LOAD', '로그인이 만료되었습니다.');
  }
}

async function ingredientCatalogVersion(executor?: ReturnType<typeof getDb> | any) {
  if (executor) {
    const [row] = await executor
      .select({ value: sql<number>`coalesce(sum(${ingredientCategory.version}), 0) + coalesce((select sum(version) from ingredient_item), 0) + coalesce((select sum(version) from ingredient_unit_option), 0)` })
      .from(ingredientCategory);
    return Number(row.value || 0);
  }
  const row = await getLibsql().execute('select coalesce(sum(version), 0) + coalesce((select sum(version) from ingredient_item), 0) + coalesce((select sum(version) from ingredient_unit_option), 0) as value from ingredient_category');
  return Number(row.rows[0]?.value || 0);
}

async function productCatalogVersion(executor?: ReturnType<typeof getDb> | any) {
  if (executor) {
    const [row] = await executor.select({ value: sql<number>`coalesce(sum(${productItem.version}), 0)` }).from(productItem);
    return Number(row.value || 0);
  }
  const row = await getLibsql().execute('select coalesce(sum(version), 0) as value from product_item');
  return Number(row.rows[0]?.value || 0);
}

app.use(
  '*',
  async (c, next) => {
    const id = c.req.header('x-request-id') || requestId();
    c.set('requestId', id);
    c.header('X-Request-Id', id);
    await next();
  },
);

app.use(
  '*',
  Sentry.sentry(app, (bindings) => {
    const dsn = bindings?.SENTRY_DSN || env.SENTRY_DSN;
    return {
      dsn,
      enabled: Boolean(dsn),
      environment: bindings?.APP_ENV || env.APP_ENV,
      tracesSampleRate: 0.05,
    };
  }),
);

app.use(
  '*',
  cors({
    origin: env.APP_ORIGIN.split(',').map((origin) => origin.trim()),
    credentials: true,
  }),
);

app.get('/health', (c) => c.json({ ok: true }));
app.get('/ready', async (c) => {
  try {
    await getLibsql().execute('select 1 as ok');
    return c.json({ ok: true });
  } catch (error) {
    console.error({ event: 'readiness_failed', requestId: getRequestId(c), error: error instanceof Error ? error.message : String(error) });
    return apiError(c, 503, 'DB_UNAVAILABLE', 'SYSTEM', 'LOAD', '데이터베이스 연결 확인에 실패했습니다.');
  }
});

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const key = clientKey(c);
  if (await isLoginBlocked(key)) {
    return apiError(c, 429, 'RATE_LIMITED', 'AUTH', 'LOGIN', '로그인 시도가 너무 많습니다. 잠시 후 다시 시도하세요.');
  }
  if (body.password !== env.APP_PASSWORD) {
    await recordFailedLogin(key);
    return apiError(c, 401, 'INVALID_PASSWORD', 'AUTH', 'LOGIN', '비밀번호가 올바르지 않습니다.');
  }
  await clearLoginAttempts(key);
  const { token, expiresAt } = await createToken();
  setCookie(c, 'shinkal_token', token, {
    httpOnly: true,
    sameSite: env.COOKIE_SAME_SITE as 'Lax' | 'None' | 'Strict',
    secure: env.COOKIE_SECURE,
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  });
  return c.json({ expiresAt });
});

app.post('/api/auth/logout', (c) => {
  deleteCookie(c, 'shinkal_token', { path: '/' });
  return c.json({ ok: true });
});

app.use('/api/*', requireAuth);

app.post('/api/ops/sentry-test', (c) => {
  if (c.req.header('x-shinkal-test') !== 'sentry') {
    return apiError(c, 403, 'FORBIDDEN', 'SYSTEM', 'LOAD', '테스트 요청 확인 헤더가 필요합니다.');
  }
  throw new Error(`Sentry Discord alert test ${getRequestId(c)}`);
});

app.get('/api/branches', async (c) => {
  const rows = await getDb().select().from(branch).where(eq(branch.isActive, 1)).orderBy(branch.branchId);
  return c.json({ branches: rows.map((row) => ({ branchId: row.branchId, name: row.name })) });
});

app.get('/api/operations/templates', (c) => c.json({ templates: checklistPages }));

app.get('/api/operations', async (c) => {
  const branchId = Number(c.req.query('branchId'));
  const businessDate = c.req.query('businessDate');
  const checklistId = Number(c.req.query('checklistId'));
  if (!branchId || !businessDate || !checklistId) {
    return apiError(c, 400, 'BAD_REQUEST', 'OPERATION', 'LOAD', '필수 조회 조건이 누락되었습니다.');
  }
  const [record] = await getDb()
    .select()
    .from(operationRecord)
    .where(and(eq(operationRecord.branchId, branchId), eq(operationRecord.businessDate, businessDate), eq(operationRecord.checklistId, checklistId)))
    .limit(1);
  if (!record) return c.json({ exists: false, version: 0, managers: [], managerName: null, managerPosition: null, totalScore: 0, totalItems: 0, checks: [] });
  const checks = await getDb().select().from(operationCheck).where(eq(operationCheck.recordId, record.recordId)).orderBy(operationCheck.sortOrder);
  const managers = parseManagers(record.managers, record.managerName, record.managerPosition);
  return c.json({
    exists: true,
    version: record.version,
    managers,
    managerName: managers[0]?.name || record.managerName,
    managerPosition: managers[0]?.position || record.managerPosition,
    totalScore: record.totalScore,
    totalItems: record.totalItems,
    checks: checks.map((row) => ({ itemKey: row.itemKey, checked: row.checked === 1 })),
  });
});

app.put('/api/operations', async (c) => {
  const body = await c.req.json();
  const template = operationTemplates.find((item) => item.checklistId === Number(body.checklistId));
  if (!template) return apiError(c, 400, 'BAD_REQUEST', 'OPERATION', 'SAVE', '존재하지 않는 운영 체크리스트입니다.', 'checklistId');

  const checks = Array.isArray(body.checks) ? body.checks : [];
  const totalScore = checks.filter((item: any) => Boolean(item.checked)).length;
  const totalItems = checks.length;
  const managers = normalizeManagers(body.managers, body.managerName, body.managerPosition);
  const primaryManager = managers[0] || { position: toText(body.managerPosition), name: toText(body.managerName) || '' };

  const result = await getDb().transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(operationRecord)
      .where(and(eq(operationRecord.branchId, body.branchId), eq(operationRecord.businessDate, body.businessDate), eq(operationRecord.checklistId, body.checklistId)))
      .limit(1);

    if (existing && existing.version !== body.version) return { conflict: true, version: existing.version };
    if (!existing && body.version !== 0) return { conflict: true, version: 0 };

    const recordId = existing
      ? (
          await tx
            .update(operationRecord)
            .set({
              managerName: toText(primaryManager.name),
              managerPosition: toText(primaryManager.position),
              managers: JSON.stringify(managers),
              totalScore,
              totalItems,
              version: existing.version + 1,
              updatedAt: sql`CURRENT_TIMESTAMP`,
            })
            .where(eq(operationRecord.recordId, existing.recordId))
            .returning({ recordId: operationRecord.recordId })
        )[0].recordId
      : (
          await tx
            .insert(operationRecord)
            .values({
              branchId: body.branchId,
              businessDate: body.businessDate,
              checklistId: body.checklistId,
              phase: template.phase,
              checklistName: template.name,
              managerName: toText(primaryManager.name),
              managerPosition: toText(primaryManager.position),
              managers: JSON.stringify(managers),
              totalScore,
              totalItems,
              version: 1,
            })
            .returning({ recordId: operationRecord.recordId })
        )[0].recordId;

    await tx.delete(operationCheck).where(eq(operationCheck.recordId, recordId));
    if (checks.length > 0) {
      await tx.insert(operationCheck).values(
        checks.map((item: any, index: number) => ({
          recordId,
          itemKey: String(item.itemKey),
          sectionName: toText(item.sectionName),
          itemLabel: String(item.itemLabel || item.itemKey),
          sortOrder: index,
          checked: item.checked ? 1 : 0,
        })),
      );
    }
    return { conflict: false, version: existing ? existing.version + 1 : 1 };
  });

  if (result.conflict) {
    return apiError(c, 409, 'VERSION_CONFLICT', 'OPERATION', 'SAVE', '다른 사람이 먼저 저장했습니다. 새로고침 후 다시 시도하세요.', null, result);
  }
  return c.json({ version: result.version, totalScore, totalItems });
});

app.get('/api/ingredients', async (c) => {
  const branchId = Number(c.req.query('branchId'));
  const businessDate = c.req.query('businessDate');
  if (!branchId || !businessDate) return apiError(c, 400, 'BAD_REQUEST', 'INGREDIENT_CHECKLIST', 'LOAD', '필수 조회 조건이 누락되었습니다.');

  const [record] = await getDb().select().from(ingredientRecord).where(and(eq(ingredientRecord.branchId, branchId), eq(ingredientRecord.businessDate, businessDate))).limit(1);
  const savedLines = record
    ? await getDb().select().from(ingredientLine).where(eq(ingredientLine.recordId, record.recordId))
    : [];
  const savedByItem = new Map(savedLines.map((line) => [line.itemId, line]));

  const items = await getDb()
    .select({
      itemId: ingredientItem.itemId,
      itemName: ingredientItem.name,
      categoryName: ingredientCategory.name,
      categorySort: ingredientCategory.sortOrder,
      itemSort: ingredientItem.sortOrder,
      defaultUnit: ingredientItem.defaultUnit,
      defaultUnitOption: ingredientItem.defaultUnitOption,
      defaultBaseUsage: ingredientItem.defaultBaseUsage,
    })
    .from(ingredientItem)
    .innerJoin(ingredientCategory, eq(ingredientCategory.categoryId, ingredientItem.categoryId))
    .where(and(eq(ingredientItem.isActive, 1), eq(ingredientCategory.isActive, 1)))
    .orderBy(ingredientCategory.sortOrder, ingredientItem.sortOrder);

  const prevUnitPrices = await findPrevUnitPriceMap(
    getDb(),
    branchId,
    businessDate,
    items.map((item) => item.itemId),
  );
  const lines = items.map((item) => {
      const saved = savedByItem.get(item.itemId);
      return {
        itemId: item.itemId,
        categoryName: item.categoryName,
        itemName: item.itemName,
        unit: saved?.unit ?? item.defaultUnit,
        unitOption: saved?.unitOption ?? item.defaultUnitOption,
        baseUsage: saved?.baseUsage ?? item.defaultBaseUsage,
        actualUsage: saved?.actualUsage ?? null,
        verdict: saved?.verdict ?? '정상',
        cause: saved?.cause ?? null,
        stock: saved?.stock ?? null,
        prevUnitPrice: saved?.prevUnitPrice ?? prevUnitPrices.get(item.itemId) ?? null,
        unitPrice: saved?.unitPrice ?? null,
      };
    });

  return c.json({
    exists: Boolean(record),
    version: record?.version ?? 0,
    catalogVersion: await ingredientCatalogVersion(),
    managerName: record?.managerName ?? null,
    lines,
  });
});

app.put('/api/ingredients', async (c) => {
  const body = await c.req.json();
  for (const [index, line] of (body.lines || []).entries()) {
    if (!verdicts.has(line.verdict)) return apiError(c, 422, 'VALIDATION_ERROR', 'INGREDIENT_CHECKLIST', 'SAVE', '판정 값이 올바르지 않습니다.', `lines.${index}.verdict`);
  }

  const result = await getDb().transaction(async (tx) => {
    const currentCatalogVersion = await ingredientCatalogVersion(tx);
    if (currentCatalogVersion !== Number(body.catalogVersion)) {
      return { catalogChanged: true, catalogVersion: currentCatalogVersion, sentCatalogVersion: body.catalogVersion };
    }
    const [existing] = await tx.select().from(ingredientRecord).where(and(eq(ingredientRecord.branchId, body.branchId), eq(ingredientRecord.businessDate, body.businessDate))).limit(1);
    if (existing && existing.version !== body.version) return { conflict: true, version: existing.version };
    if (!existing && body.version !== 0) return { conflict: true, version: 0 };
    const recordId = existing
      ? (
          await tx
            .update(ingredientRecord)
            .set({ managerName: toText(body.managerName), version: existing.version + 1, updatedAt: sql`CURRENT_TIMESTAMP` })
            .where(eq(ingredientRecord.recordId, existing.recordId))
            .returning({ recordId: ingredientRecord.recordId })
        )[0].recordId
      : (
          await tx
            .insert(ingredientRecord)
            .values({ branchId: body.branchId, businessDate: body.businessDate, managerName: toText(body.managerName), version: 1 })
            .returning({ recordId: ingredientRecord.recordId })
        )[0].recordId;
    await tx.delete(ingredientLine).where(eq(ingredientLine.recordId, recordId));
    const lines = body.lines || [];
    if (lines.length > 0) {
      const values = [];
      const prevUnitPrices = await findPrevUnitPriceMap(
        tx,
        body.branchId,
        body.businessDate,
        lines.map((line: any) => line.itemId),
      );
      for (const [index, line] of lines.entries()) {
        values.push({
          recordId,
          itemId: line.itemId,
          unit: toText(line.unit),
          unitOption: line.unitOption == null || line.unitOption === '' ? null : String(line.unitOption),
          baseUsage: toNumber(line.baseUsage),
          actualUsage: toNumber(line.actualUsage),
          verdict: line.verdict,
          cause: toText(line.cause),
          stock: toNumber(line.stock),
          prevUnitPrice: prevUnitPrices.get(line.itemId) ?? null,
          unitPrice: toNumber(line.unitPrice),
          sortOrder: index,
        });
      }
      await tx.insert(ingredientLine).values(values);
    }
    return { conflict: false, version: existing ? existing.version + 1 : 1, catalogVersion: currentCatalogVersion };
  });

  if (result.catalogChanged) {
    return apiError(c, 409, 'CATALOG_CHANGED', 'INGREDIENT_CHECKLIST', 'SAVE', '품목 설정이 변경되었습니다. 새로고침 후 다시 시도하세요.', null, {
      expectedCatalogVersion: result.catalogVersion,
      sentCatalogVersion: result.sentCatalogVersion,
    });
  }
  if (result.conflict) return apiError(c, 409, 'VERSION_CONFLICT', 'INGREDIENT_CHECKLIST', 'SAVE', '다른 사람이 먼저 저장했습니다. 새로고침 후 다시 시도하세요.', null, result);
  return c.json({ version: result.version, catalogVersion: result.catalogVersion });
});

app.get('/api/products', async (c) => {
  const branchId = Number(c.req.query('branchId'));
  const businessDate = c.req.query('businessDate');
  if (!branchId || !businessDate) return apiError(c, 400, 'BAD_REQUEST', 'PRODUCT_CHECKLIST', 'LOAD', '필수 조회 조건이 누락되었습니다.');
  const [record] = await getDb().select().from(productRecord).where(and(eq(productRecord.branchId, branchId), eq(productRecord.businessDate, businessDate))).limit(1);
  const savedLines = record ? await getDb().select().from(productLine).where(eq(productLine.recordId, record.recordId)) : [];
  const savedByItem = new Map(savedLines.map((line) => [line.itemId, line]));
  const items = await getDb().select().from(productItem).where(eq(productItem.isActive, 1)).orderBy(productItem.sortOrder);
  return c.json({
    exists: Boolean(record),
    version: record?.version ?? 0,
    catalogVersion: await productCatalogVersion(),
    managerName: record?.managerName ?? null,
    lines: items.map((item) => ({
      itemId: item.itemId,
      itemName: item.name,
      unit: savedByItem.get(item.itemId)?.unit ?? item.defaultUnit,
      spareStock: item.spareStock,
      stock: savedByItem.get(item.itemId)?.stock ?? null,
      restockQty: savedByItem.get(item.itemId)?.restockQty ?? null,
    })),
  });
});

app.put('/api/products', async (c) => {
  const body = await c.req.json();
  const result = await getDb().transaction(async (tx) => {
    const currentCatalogVersion = await productCatalogVersion(tx);
    if (currentCatalogVersion !== Number(body.catalogVersion)) return { catalogChanged: true, catalogVersion: currentCatalogVersion, sentCatalogVersion: body.catalogVersion };
    const [existing] = await tx.select().from(productRecord).where(and(eq(productRecord.branchId, body.branchId), eq(productRecord.businessDate, body.businessDate))).limit(1);
    if (existing && existing.version !== body.version) return { conflict: true, version: existing.version };
    if (!existing && body.version !== 0) return { conflict: true, version: 0 };
    const recordId = existing
      ? (
          await tx
            .update(productRecord)
            .set({ managerName: toText(body.managerName), version: existing.version + 1, updatedAt: sql`CURRENT_TIMESTAMP` })
            .where(eq(productRecord.recordId, existing.recordId))
            .returning({ recordId: productRecord.recordId })
        )[0].recordId
      : (
          await tx.insert(productRecord).values({ branchId: body.branchId, businessDate: body.businessDate, managerName: toText(body.managerName), version: 1 }).returning({ recordId: productRecord.recordId })
        )[0].recordId;
    await tx.delete(productLine).where(eq(productLine.recordId, recordId));
    const lines = body.lines || [];
    if (lines.length > 0) {
      await tx.insert(productLine).values(
        lines.map((line: any, index: number) => ({
          recordId,
          itemId: line.itemId,
          unit: productUnits.has(String(line.unit)) ? String(line.unit) : null,
          stock: toNumber(line.stock),
          restockQty: toNumber(line.restockQty),
          sortOrder: index,
        })),
      );
    }
    return { conflict: false, version: existing ? existing.version + 1 : 1, catalogVersion: currentCatalogVersion };
  });
  if (result.catalogChanged) {
    return apiError(c, 409, 'CATALOG_CHANGED', 'PRODUCT_CHECKLIST', 'SAVE', '품목 설정이 변경되었습니다. 새로고침 후 다시 시도하세요.', null, {
      expectedCatalogVersion: result.catalogVersion,
      sentCatalogVersion: result.sentCatalogVersion,
    });
  }
  if (result.conflict) return apiError(c, 409, 'VERSION_CONFLICT', 'PRODUCT_CHECKLIST', 'SAVE', '다른 사람이 먼저 저장했습니다. 새로고침 후 다시 시도하세요.', null, result);
  return c.json({ version: result.version, catalogVersion: result.catalogVersion });
});

app.get('/api/stats/ingredients', async (c) => {
  const branchId = Number(c.req.query('branchId'));
  const month = monthFromQuery(c.req.query('month'));
  if (!branchId || !month) return apiError(c, 400, 'BAD_REQUEST', 'STATS', 'LOAD', '필수 조회 조건이 누락되었습니다.');

  const trendStartMonth = addMonths(month, -11);
  const trendMonths = monthsBetween(trendStartMonth, month);
  const trendStartDate = monthStart(trendStartMonth);
  const selectedStartDate = monthStart(month);
  const selectedEndDate = monthEnd(month);
  const previousMonth = addMonths(month, -1);
  const previousStartDate = monthStart(previousMonth);
  const previousEndDate = monthEnd(previousMonth);

  const [priceRows, currentPriceRows, previousPriceRows, usageRows] = await Promise.all([
    getLibsql().execute({
      sql: `
        select
          substr(ir.business_date, 1, 7) as month,
          il.item_id as itemId,
          ii.name as itemName,
          avg(il.unit_price) as avgPrice,
          min(il.unit_price) as minPrice,
          max(il.unit_price) as maxPrice,
          count(il.unit_price) as count
        from ingredient_line il
        join ingredient_record ir on ir.record_id = il.record_id
        join ingredient_item ii on ii.item_id = il.item_id
        where ir.branch_id = ?
          and ir.business_date >= ?
          and ir.business_date <= ?
          and il.unit_price is not null
        group by substr(ir.business_date, 1, 7), il.item_id, ii.name
        order by ii.sort_order, ii.item_id, month
      `,
      args: [branchId, trendStartDate, selectedEndDate],
    }),
    getLibsql().execute({
      sql: `
        select il.item_id as itemId, ii.name as itemName, avg(il.unit_price) as avgPrice
        from ingredient_line il
        join ingredient_record ir on ir.record_id = il.record_id
        join ingredient_item ii on ii.item_id = il.item_id
        where ir.branch_id = ? and ir.business_date >= ? and ir.business_date <= ? and il.unit_price is not null
        group by il.item_id, ii.name
      `,
      args: [branchId, selectedStartDate, selectedEndDate],
    }),
    getLibsql().execute({
      sql: `
        select il.item_id as itemId, avg(il.unit_price) as avgPrice
        from ingredient_line il
        join ingredient_record ir on ir.record_id = il.record_id
        where ir.branch_id = ? and ir.business_date >= ? and ir.business_date <= ? and il.unit_price is not null
        group by il.item_id
      `,
      args: [branchId, previousStartDate, previousEndDate],
    }),
    getLibsql().execute({
      sql: `
        select
          il.item_id as itemId,
          ii.name as itemName,
          coalesce(sum(il.actual_usage), 0) as actualUsage,
          coalesce(sum(il.base_usage), 0) as baseUsage,
          coalesce(sum(coalesce(il.actual_usage, 0) - coalesce(il.base_usage, 0)), 0) as difference
        from ingredient_line il
        join ingredient_record ir on ir.record_id = il.record_id
        join ingredient_item ii on ii.item_id = il.item_id
        where ir.branch_id = ? and ir.business_date >= ? and ir.business_date <= ?
        group by il.item_id, ii.name
        having actualUsage != 0 or baseUsage != 0 or difference != 0
        order by actualUsage desc, ii.sort_order
      `,
      args: [branchId, selectedStartDate, selectedEndDate],
    }),
  ]);

  type PriceRow = { month: string; itemId: number; itemName: string; avgPrice: number; minPrice: number; maxPrice: number; count: number };
  type AvgRow = { itemId: number; itemName?: string; avgPrice: number };
  type UsageRow = { itemId: number; itemName: string; actualUsage: number; baseUsage: number; difference: number };
  const prices = priceRows.rows.map((row) => ({
    month: String(row.month),
    itemId: Number(row.itemId),
    itemName: String(row.itemName),
    avgPrice: roundMetric(Number(row.avgPrice)),
    minPrice: roundMetric(Number(row.minPrice)),
    maxPrice: roundMetric(Number(row.maxPrice)),
    count: Number(row.count || 0),
  })) as PriceRow[];

  const itemMap = new Map<number, string>();
  for (const row of prices) itemMap.set(row.itemId, row.itemName);
  const priceTrend = [...itemMap.entries()].map(([itemId, itemName]) => {
    const byMonth = new Map(prices.filter((row) => row.itemId === itemId).map((row) => [row.month, row]));
    return {
      itemId,
      itemName,
      points: trendMonths.map((trendMonth) => byMonth.get(trendMonth) ?? { month: trendMonth, itemId, itemName, avgPrice: null, minPrice: null, maxPrice: null, count: 0 }),
    };
  });

  const previousByItem = new Map(
    previousPriceRows.rows.map((row) => [Number(row.itemId), roundMetric(Number(row.avgPrice))]),
  );
  const priceIncreaseTop5 = (currentPriceRows.rows as unknown as AvgRow[])
    .map((row) => {
      const itemId = Number(row.itemId);
      const currentAvg = roundMetric(Number(row.avgPrice));
      const previousAvg = previousByItem.get(itemId);
      return {
        itemId,
        itemName: String(row.itemName || ''),
        currentAvg,
        previousAvg: previousAvg ?? null,
        increase: previousAvg === undefined ? 0 : roundMetric(currentAvg - previousAvg),
      };
    })
    .filter((row) => row.previousAvg !== null && row.increase > 0)
    .sort((a, b) => b.increase - a.increase)
    .slice(0, 5);

  const usageSummary = (usageRows.rows as unknown as UsageRow[]).map((row) => ({
    itemId: Number(row.itemId),
    itemName: String(row.itemName),
    actualUsage: roundMetric(Number(row.actualUsage)),
    baseUsage: roundMetric(Number(row.baseUsage)),
    difference: roundMetric(Number(row.difference)),
  }));
  const excessTop10 = usageSummary
    .filter((row) => row.difference > 0)
    .sort((a, b) => b.difference - a.difference)
    .slice(0, 10)
    .map((row) => ({
      itemId: row.itemId,
      itemName: row.itemName,
      excessUsage: row.difference,
      actualUsage: row.actualUsage,
      baseUsage: row.baseUsage,
    }));
  const usageTotals = usageSummary.reduce(
    (acc, row) => ({
      actualUsage: roundMetric(acc.actualUsage + row.actualUsage),
      baseUsage: roundMetric(acc.baseUsage + row.baseUsage),
      difference: roundMetric(acc.difference + row.difference),
    }),
    { actualUsage: 0, baseUsage: 0, difference: 0 },
  );

  return c.json({
    month,
    trendMonths,
    priceItems: [...itemMap.entries()].map(([itemId, itemName]) => ({ itemId, itemName })),
    priceTrend,
    priceIncreaseTop5,
    excessItemCount: usageSummary.filter((row) => row.difference > 0).length,
    excessTop10,
    usageSummary,
    usageTotals,
  });
});

app.get('/api/stats/products', async (c) => {
  const branchId = Number(c.req.query('branchId'));
  const month = monthFromQuery(c.req.query('month'));
  if (!branchId || !month) return apiError(c, 400, 'BAD_REQUEST', 'STATS', 'LOAD', '필수 조회 조건이 누락되었습니다.');

  const startMonth = addMonths(month, -5);
  const months = monthsBetween(startMonth, month);
  const selectedStartDate = monthStart(startMonth);
  const selectedEndDate = monthEnd(month);
  const readStartDate = addDays(selectedStartDate, -1);
  const rows = await getLibsql().execute({
    sql: `
      select
        pr.business_date as businessDate,
        pl.item_id as itemId,
        pi.name as itemName,
        pl.stock as stock,
        pl.restock_qty as restockQty
      from product_line pl
      join product_record pr on pr.record_id = pl.record_id
      join product_item pi on pi.item_id = pl.item_id
      where pr.branch_id = ? and pr.business_date >= ? and pr.business_date <= ?
      order by pl.item_id, pr.business_date
    `,
    args: [branchId, readStartDate, selectedEndDate],
  });

  type ProductStockRow = { businessDate: string; itemId: number; itemName: string; stock: number | null; restockQty: number | null };
  const stockRows = rows.rows.map((row) => ({
    businessDate: String(row.businessDate),
    itemId: Number(row.itemId),
    itemName: String(row.itemName),
    stock: row.stock === null || row.stock === undefined ? null : Number(row.stock),
    restockQty: row.restockQty === null || row.restockQty === undefined ? null : Number(row.restockQty),
  })) as ProductStockRow[];

  const items = new Map<number, string>();
  const byItemDate = new Map<string, ProductStockRow>();
  for (const row of stockRows) {
    items.set(row.itemId, row.itemName);
    byItemDate.set(`${row.itemId}:${row.businessDate}`, row);
  }

  const monthUsage = new Map<string, { itemId: number; itemName: string; month: string; totalUsage: number; days: number }>();
  for (const row of stockRows) {
    if (row.businessDate < selectedStartDate || row.businessDate > selectedEndDate || row.stock === null) continue;
    const previous = byItemDate.get(`${row.itemId}:${addDays(row.businessDate, -1)}`);
    if (!previous || previous.stock === null) continue;
    const dailyUsage = Math.max((previous.stock || 0) + (row.restockQty || 0) - row.stock, 0);
    const usageMonth = row.businessDate.slice(0, 7);
    const key = `${row.itemId}:${usageMonth}`;
    const current = monthUsage.get(key) || { itemId: row.itemId, itemName: row.itemName, month: usageMonth, totalUsage: 0, days: 0 };
    current.totalUsage = roundMetric(current.totalUsage + dailyUsage);
    current.days += 1;
    monthUsage.set(key, current);
  }

  const monthlyAverages = [...items.entries()].map(([itemId, itemName]) => ({
    itemId,
    itemName,
    points: months.map((usageMonth) => {
      const row = monthUsage.get(`${itemId}:${usageMonth}`);
      return {
        month: usageMonth,
        avgDailyUsage: row ? roundMetric(row.totalUsage / row.days) : 0,
        totalUsage: row ? roundMetric(row.totalUsage) : 0,
        days: row?.days || 0,
      };
    }),
  }));

  return c.json({
    month,
    months,
    productItems: [...items.entries()].map(([itemId, itemName]) => ({ itemId, itemName })),
    monthlyAverages,
  });
});

app.get('/api/stats/operations', async (c) => {
  const branchId = Number(c.req.query('branchId'));
  const month = monthFromQuery(c.req.query('month'));
  if (!branchId || !month) return apiError(c, 400, 'BAD_REQUEST', 'STATS', 'LOAD', '필수 조회 조건이 누락되었습니다.');

  const selectedStartDate = monthStart(month);
  const selectedEndDate = monthEnd(month);
  const [missingRows, scoreRows, overallRows] = await Promise.all([
    getLibsql().execute({
      sql: `
        select
          oc.item_key as itemKey,
          oc.item_label as itemLabel,
          oc.section_name as sectionName,
          orc.checklist_name as checklistName,
          count(*) as missingCount
        from operation_check oc
        join operation_record orc on orc.record_id = oc.record_id
        where orc.branch_id = ? and orc.business_date >= ? and orc.business_date <= ? and oc.checked = 0
        group by oc.item_key, oc.item_label, oc.section_name, orc.checklist_name
        order by missingCount desc, orc.checklist_id, oc.sort_order
        limit 5
      `,
      args: [branchId, selectedStartDate, selectedEndDate],
    }),
    getLibsql().execute({
      sql: `
        select
          checklist_id as checklistId,
          checklist_name as checklistName,
          avg(case when total_items > 0 then cast(total_score as real) / total_items * 100 else 0 end) as avgCompletionRate,
          count(*) as recordCount
        from operation_record
        where branch_id = ? and business_date >= ? and business_date <= ?
        group by checklist_id, checklist_name
        order by checklist_id
      `,
      args: [branchId, selectedStartDate, selectedEndDate],
    }),
    getLibsql().execute({
      sql: `
        select avg(case when total_items > 0 then cast(total_score as real) / total_items * 100 else 0 end) as overallCompletionRate
        from operation_record
        where branch_id = ? and business_date >= ? and business_date <= ?
      `,
      args: [branchId, selectedStartDate, selectedEndDate],
    }),
  ]);
  const completionByChecklist = new Map(
    scoreRows.rows.map((row) => [
      Number(row.checklistId),
      {
        checklistName: String(row.checklistName),
        avgCompletionRate: roundMetric(Number(row.avgCompletionRate)),
        recordCount: Number(row.recordCount || 0),
      },
    ]),
  );
  const completionRates = operationTemplates.map((template) => {
    const row = completionByChecklist.get(template.checklistId);
    return {
      checklistId: template.checklistId,
      checklistName: row?.checklistName || template.name,
      avgCompletionRate: row?.avgCompletionRate || 0,
      recordCount: row?.recordCount || 0,
      hasRecord: Boolean(row),
    };
  });

  return c.json({
    month,
    overallCompletionRate: roundMetric(Number(overallRows.rows[0]?.overallCompletionRate ?? 0)),
    missingTop5: missingRows.rows.map((row) => ({
      itemKey: String(row.itemKey),
      itemLabel: String(row.itemLabel),
      sectionName: row.sectionName ? String(row.sectionName) : null,
      checklistName: String(row.checklistName),
      missingCount: Number(row.missingCount || 0),
    })),
    completionRates,
  });
});

app.get('/api/settings/ingredients', async (c) => {
  const [categories, items, unitOptions] = await Promise.all([
    getDb().select().from(ingredientCategory).where(eq(ingredientCategory.isActive, 1)).orderBy(ingredientCategory.sortOrder),
    getDb().select().from(ingredientItem).where(eq(ingredientItem.isActive, 1)).orderBy(ingredientItem.categoryId, ingredientItem.sortOrder),
    getDb().select().from(ingredientUnitOption).where(eq(ingredientUnitOption.isActive, 1)).orderBy(ingredientUnitOption.unit, ingredientUnitOption.sortOrder),
  ]);
  return c.json({
    catalogVersion: await ingredientCatalogVersion(),
    categories: categories.map(({ categoryId, name, sortOrder, version }) => ({ categoryId, name, sortOrder, version })),
    items: items.map(({ itemId, categoryId, name, defaultUnit, defaultUnitOption, defaultBaseUsage, sortOrder, version }) => ({
      itemId,
      categoryId,
      name,
      defaultUnit,
      defaultUnitOption,
      defaultBaseUsage,
      sortOrder,
      version,
    })),
    unitOptions: unitOptions.map(({ optionId, unit, value, sortOrder, version }) => ({ optionId, unit, value, sortOrder, version })),
  });
});

app.get('/api/settings/products', async (c) => {
  const rows = await getDb().select().from(productItem).where(eq(productItem.isActive, 1)).orderBy(productItem.sortOrder);
  return c.json({ catalogVersion: await productCatalogVersion(), items: rows.map(({ itemId, name, defaultUnit, spareStock, sortOrder, version }) => ({ itemId, name, defaultUnit, spareStock, sortOrder, version })) });
});

app.patch('/api/settings/:kind/reorder', async (c) => {
  const kind = c.req.param('kind');
  const body = await c.req.json();
  const orderedIds: number[] = Array.isArray(body.orderedIds) ? body.orderedIds.map((id: unknown) => Number(id)) : [];
  if (!orderedIds.length || orderedIds.some((id) => !Number.isFinite(id))) {
    return apiError(c, 422, 'VALIDATION_ERROR', 'PRODUCT_SETTINGS', 'REORDER', '순서 변경 값이 올바르지 않습니다.', 'orderedIds');
  }
  async function applyReorder(statements: { sql: string; args: number[] }[], domain: Domain) {
    try {
      await getLibsql().batch(statements, 'write');
      return null;
    } catch (error) {
      console.error('REORDER_BATCH_FAILED', { kind, orderedIds, error });
      return apiError(c, 500, 'INTERNAL_ERROR', domain, 'REORDER', '순서 변경 중 오류가 발생했습니다.');
    }
  }
  if (kind === 'ingredient-categories') {
    const error = await applyReorder(orderedIds.map((id, index) => ({ sql: 'update ingredient_category set sort_order = ?, version = version + 1 where category_id = ?', args: [index, id] })), 'INGREDIENT_SETTINGS');
    if (error) return error;
    return c.json({ catalogVersion: await ingredientCatalogVersion() });
  }
  if (kind === 'ingredient-items') {
    const error = await applyReorder(orderedIds.map((id, index) => ({ sql: 'update ingredient_item set sort_order = ?, version = version + 1 where item_id = ?', args: [index, id] })), 'INGREDIENT_SETTINGS');
    if (error) return error;
    return c.json({ catalogVersion: await ingredientCatalogVersion() });
  }
  if (kind === 'ingredient-unit-options') {
    const error = await applyReorder(orderedIds.map((id, index) => ({ sql: 'update ingredient_unit_option set sort_order = ?, version = version + 1 where option_id = ?', args: [index, id] })), 'INGREDIENT_SETTINGS');
    if (error) return error;
    return c.json({ catalogVersion: await ingredientCatalogVersion() });
  }
  if (kind === 'product-items') {
    const error = await applyReorder(orderedIds.map((id, index) => ({ sql: 'update product_item set sort_order = ?, version = version + 1 where item_id = ?', args: [index, id] })), 'PRODUCT_SETTINGS');
    if (error) return error;
    return c.json({ catalogVersion: await productCatalogVersion() });
  }
  return apiError(c, 400, 'BAD_REQUEST', 'PRODUCT_SETTINGS', 'REORDER', '지원하지 않는 순서변경입니다.');
});

app.post('/api/settings/ingredient-categories', async (c) => {
  const body = await c.req.json();
  if (!toText(body.name)) return apiError(c, 422, 'VALIDATION_ERROR', 'INGREDIENT_SETTINGS', 'CREATE', '카테고리명을 입력하세요.', 'name');
  const [maxSort] = await getDb().select({ value: sql<number>`coalesce(max(${ingredientCategory.sortOrder}), -1)` }).from(ingredientCategory);
  const [row] = await getDb().insert(ingredientCategory).values({ name: body.name.trim(), sortOrder: Number(maxSort.value) + 1 }).returning({ categoryId: ingredientCategory.categoryId, version: ingredientCategory.version });
  return c.json({ ...row, catalogVersion: await ingredientCatalogVersion() });
});

app.patch('/api/settings/ingredient-categories/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const rows = await getDb()
    .update(ingredientCategory)
    .set({ name: String(body.name || '').trim(), version: sql`${ingredientCategory.version} + 1` })
    .where(and(eq(ingredientCategory.categoryId, id), eq(ingredientCategory.version, body.version), eq(ingredientCategory.isActive, 1)))
    .returning({ categoryId: ingredientCategory.categoryId, version: ingredientCategory.version });
  if (!rows[0]) return apiError(c, 409, 'VERSION_CONFLICT', 'INGREDIENT_SETTINGS', 'UPDATE', '다른 사용자가 먼저 수정했습니다.');
  return c.json({ ...rows[0], catalogVersion: await ingredientCatalogVersion() });
});

app.delete('/api/settings/ingredient-categories/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const rows = await getDb()
    .update(ingredientCategory)
    .set({ isActive: 0, version: sql`${ingredientCategory.version} + 1` })
    .where(and(eq(ingredientCategory.categoryId, id), eq(ingredientCategory.version, body.version)))
    .returning({ categoryId: ingredientCategory.categoryId, version: ingredientCategory.version });
  if (!rows[0]) return apiError(c, 409, 'VERSION_CONFLICT', 'INGREDIENT_SETTINGS', 'DELETE', '다른 사용자가 먼저 수정했습니다.');
  return c.json({ ...rows[0], catalogVersion: await ingredientCatalogVersion() });
});

app.post('/api/settings/ingredient-items', async (c) => {
  const body = await c.req.json();
  if (!toText(body.name)) return apiError(c, 422, 'VALIDATION_ERROR', 'INGREDIENT_SETTINGS', 'CREATE', '품목명을 입력하세요.', 'name');
  const [maxSort] = await getDb().select({ value: sql<number>`coalesce(max(${ingredientItem.sortOrder}), -1)` }).from(ingredientItem).where(eq(ingredientItem.categoryId, body.categoryId));
  const [row] = await getDb()
    .insert(ingredientItem)
    .values({
      categoryId: body.categoryId,
      name: body.name.trim(),
      defaultUnit: toText(body.defaultUnit),
      defaultUnitOption: body.defaultUnitOption == null ? null : String(body.defaultUnitOption),
      defaultBaseUsage: toNumber(body.defaultBaseUsage),
      sortOrder: Number(maxSort.value) + 1,
    })
    .returning({ itemId: ingredientItem.itemId, version: ingredientItem.version });
  return c.json({ ...row, catalogVersion: await ingredientCatalogVersion() });
});

app.patch('/api/settings/ingredient-items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const rows = await getDb()
    .update(ingredientItem)
    .set({
      categoryId: body.categoryId,
      name: String(body.name || '').trim(),
      defaultUnit: toText(body.defaultUnit),
      defaultUnitOption: body.defaultUnitOption == null ? null : String(body.defaultUnitOption),
      defaultBaseUsage: toNumber(body.defaultBaseUsage),
      version: sql`${ingredientItem.version} + 1`,
    })
    .where(and(eq(ingredientItem.itemId, id), eq(ingredientItem.version, body.version), eq(ingredientItem.isActive, 1)))
    .returning({ itemId: ingredientItem.itemId, version: ingredientItem.version });
  if (!rows[0]) return apiError(c, 409, 'VERSION_CONFLICT', 'INGREDIENT_SETTINGS', 'UPDATE', '다른 사용자가 먼저 수정했습니다.');
  return c.json({ ...rows[0], catalogVersion: await ingredientCatalogVersion() });
});

app.delete('/api/settings/ingredient-items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const rows = await getDb()
    .update(ingredientItem)
    .set({ isActive: 0, version: sql`${ingredientItem.version} + 1` })
    .where(and(eq(ingredientItem.itemId, id), eq(ingredientItem.version, body.version)))
    .returning({ itemId: ingredientItem.itemId, version: ingredientItem.version });
  if (!rows[0]) return apiError(c, 409, 'VERSION_CONFLICT', 'INGREDIENT_SETTINGS', 'DELETE', '다른 사용자가 먼저 수정했습니다.');
  return c.json({ ...rows[0], catalogVersion: await ingredientCatalogVersion() });
});

app.post('/api/settings/ingredient-unit-options', async (c) => {
  const body = await c.req.json();
  const value = parseFiniteNumber(body.value);
  if (!toText(body.unit)) return apiError(c, 422, 'VALIDATION_ERROR', 'INGREDIENT_SETTINGS', 'CREATE', '단위를 선택하세요.', 'unit');
  if (value === null) return apiError(c, 422, 'VALIDATION_ERROR', 'INGREDIENT_SETTINGS', 'CREATE', '옵션 값은 숫자여야 합니다.', 'value');
  try {
    const [maxSort] = await getDb().select({ value: sql<number>`coalesce(max(${ingredientUnitOption.sortOrder}), -1)` }).from(ingredientUnitOption).where(eq(ingredientUnitOption.unit, body.unit));
    const [row] = await getDb().insert(ingredientUnitOption).values({ unit: body.unit, value, sortOrder: Number(maxSort.value) + 1 }).returning({ optionId: ingredientUnitOption.optionId, version: ingredientUnitOption.version });
    return c.json({ ...row, catalogVersion: await ingredientCatalogVersion() });
  } catch (error) {
    if (isUniqueConstraintError(error)) return apiError(c, 409, 'DUPLICATE', 'INGREDIENT_SETTINGS', 'CREATE', '이미 있는 값입니다.', 'value');
    return apiError(c, 500, 'INTERNAL_ERROR', 'INGREDIENT_SETTINGS', 'CREATE', '설정 저장 중 오류가 발생했습니다.');
  }
});

app.patch('/api/settings/ingredient-unit-options/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const value = parseFiniteNumber(body.value);
  if (value === null) return apiError(c, 422, 'VALIDATION_ERROR', 'INGREDIENT_SETTINGS', 'UPDATE', '옵션 값은 숫자여야 합니다.', 'value');
  try {
    const rows = await getDb()
      .update(ingredientUnitOption)
      .set({ value, version: sql`${ingredientUnitOption.version} + 1` })
      .where(and(eq(ingredientUnitOption.optionId, id), eq(ingredientUnitOption.version, body.version), eq(ingredientUnitOption.isActive, 1)))
      .returning({ optionId: ingredientUnitOption.optionId, version: ingredientUnitOption.version });
    if (!rows[0]) return apiError(c, 409, 'VERSION_CONFLICT', 'INGREDIENT_SETTINGS', 'UPDATE', '다른 사용자가 먼저 수정했습니다.');
    return c.json({ ...rows[0], catalogVersion: await ingredientCatalogVersion() });
  } catch (error) {
    if (isUniqueConstraintError(error)) return apiError(c, 409, 'DUPLICATE', 'INGREDIENT_SETTINGS', 'UPDATE', '이미 있는 값입니다.', 'value');
    return apiError(c, 500, 'INTERNAL_ERROR', 'INGREDIENT_SETTINGS', 'UPDATE', '설정 저장 중 오류가 발생했습니다.');
  }
});

app.delete('/api/settings/ingredient-unit-options/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const rows = await getDb()
    .update(ingredientUnitOption)
    .set({ isActive: 0, version: sql`${ingredientUnitOption.version} + 1` })
    .where(and(eq(ingredientUnitOption.optionId, id), eq(ingredientUnitOption.version, body.version)))
    .returning({ optionId: ingredientUnitOption.optionId, version: ingredientUnitOption.version });
  if (!rows[0]) return apiError(c, 409, 'VERSION_CONFLICT', 'INGREDIENT_SETTINGS', 'DELETE', '다른 사용자가 먼저 수정했습니다.');
  return c.json({ ...rows[0], catalogVersion: await ingredientCatalogVersion() });
});

app.post('/api/settings/product-items', async (c) => {
  const body = await c.req.json();
  if (!toText(body.name)) return apiError(c, 422, 'VALIDATION_ERROR', 'PRODUCT_SETTINGS', 'CREATE', '품목명을 입력하세요.', 'name');
  const [maxSort] = await getDb().select({ value: sql<number>`coalesce(max(${productItem.sortOrder}), -1)` }).from(productItem);
  const [row] = await getDb()
    .insert(productItem)
    .values({ name: body.name.trim(), defaultUnit: toText(body.defaultUnit), spareStock: toNumber(body.spareStock), sortOrder: Number(maxSort.value) + 1 })
    .returning({ itemId: productItem.itemId, version: productItem.version });
  return c.json({ ...row, catalogVersion: await productCatalogVersion() });
});

app.patch('/api/settings/product-items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json();
  const rows = await getDb()
    .update(productItem)
    .set({ name: String(body.name || '').trim(), defaultUnit: toText(body.defaultUnit), spareStock: toNumber(body.spareStock), version: sql`${productItem.version} + 1` })
    .where(and(eq(productItem.itemId, id), eq(productItem.version, body.version), eq(productItem.isActive, 1)))
    .returning({ itemId: productItem.itemId, version: productItem.version });
  if (!rows[0]) return apiError(c, 409, 'VERSION_CONFLICT', 'PRODUCT_SETTINGS', 'UPDATE', '다른 사용자가 먼저 수정했습니다.');
  return c.json({ ...rows[0], catalogVersion: await productCatalogVersion() });
});

app.delete('/api/settings/product-items/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => ({}));
  const rows = await getDb()
    .update(productItem)
    .set({ isActive: 0, version: sql`${productItem.version} + 1` })
    .where(and(eq(productItem.itemId, id), eq(productItem.version, body.version)))
    .returning({ itemId: productItem.itemId, version: productItem.version });
  if (!rows[0]) return apiError(c, 409, 'VERSION_CONFLICT', 'PRODUCT_SETTINGS', 'DELETE', '다른 사용자가 먼저 수정했습니다.');
  return c.json({ ...rows[0], catalogVersion: await productCatalogVersion() });
});

async function findPrevUnitPriceMap(executor: ReturnType<typeof getDb> | any, branchId: number, businessDate: string, itemIds: number[]) {
  const prices = new Map<number, number | null>();
  const uniqueItemIds = [...new Set(itemIds.filter((itemId) => Number.isFinite(Number(itemId))))];
  if (uniqueItemIds.length === 0) return prices;

  const rows = await executor
    .select({
      itemId: ingredientLine.itemId,
      unitPrice: ingredientLine.unitPrice,
      businessDate: ingredientRecord.businessDate,
    })
    .from(ingredientLine)
    .innerJoin(ingredientRecord, eq(ingredientRecord.recordId, ingredientLine.recordId))
    .where(and(eq(ingredientRecord.branchId, branchId), inArray(ingredientLine.itemId, uniqueItemIds), lt(ingredientRecord.businessDate, businessDate), sql`${ingredientLine.unitPrice} is not null`))
    .orderBy(ingredientLine.itemId, desc(ingredientRecord.businessDate));

  for (const row of rows) {
    if (!prices.has(row.itemId)) prices.set(row.itemId, row.unitPrice);
  }
  return prices;
}

export default app;
