import { getLibsql } from './db/client';
import { env as localEnv } from './env';

type ScheduledEnv = {
  DISCORD_WEBHOOK_URL?: string;
  OPS_MIN_ACTIVITY_HOURS?: string;
};

type CheckResult = {
  ok: boolean;
  title: string;
  detail: string;
};

function getEnvValue(runtimeEnv: ScheduledEnv | undefined, key: keyof ScheduledEnv) {
  return runtimeEnv?.[key] || localEnv[key];
}

function numberFromRow(value: unknown) {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseSqliteTimestamp(value: unknown) {
  if (!value) return null;
  const text = String(value);
  const timestamp = text.includes('T') ? text : `${text.replace(' ', 'T')}Z`;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function sendDiscordMessage(webhookUrl: string | undefined, content: string) {
  if (!webhookUrl) {
    console.warn({ event: 'ops_discord_skipped', reason: 'missing_webhook' });
    return;
  }

  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'shinkal', content }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Discord notification failed: ${response.status} ${body}`);
  }
}

async function checkDataIntegrity(): Promise<CheckResult> {
  const result = await getLibsql().execute(`
    select
      (select count(*) from operation_record where version < 1 or total_score < 0 or total_items < 0) as bad_operation_records,
      (select count(*) from ingredient_record where version < 1) as bad_ingredient_records,
      (select count(*) from product_record where version < 1) as bad_product_records,
      (select count(*) from ingredient_category where version < 1 or sort_order < 0) as bad_ingredient_categories,
      (select count(*) from ingredient_item where version < 1 or sort_order < 0 or coalesce(default_base_usage, 0) < 0) as bad_ingredient_items,
      (select count(*) from ingredient_unit_option where version < 1 or sort_order < 0 or value < 0) as bad_unit_options,
      (select count(*) from ingredient_line where sort_order < 0 or coalesce(base_usage, 0) < 0 or coalesce(actual_usage, 0) < 0 or coalesce(stock, 0) < 0 or coalesce(prev_unit_price, 0) < 0 or coalesce(unit_price, 0) < 0) as bad_ingredient_lines,
      (select count(*) from product_item where version < 1 or sort_order < 0 or coalesce(spare_stock, 0) < 0) as bad_product_items,
      (select count(*) from product_line where sort_order < 0 or coalesce(stock, 0) < 0 or coalesce(restock_qty, 0) < 0) as bad_product_lines
  `);

  const row = result.rows[0] ?? {};
  const entries = Object.entries(row)
    .map(([key, value]) => [key, numberFromRow(value)] as const)
    .filter(([, value]) => value > 0);

  if (entries.length === 0) {
    return { ok: true, title: '데이터 무결성 점검', detail: '이상값이 없습니다.' };
  }

  return {
    ok: false,
    title: '데이터 무결성 점검 실패',
    detail: entries.map(([key, value]) => `${key}: ${value}건`).join(', '),
  };
}

async function checkRecentActivity(runtimeEnv: ScheduledEnv | undefined): Promise<CheckResult> {
  const thresholdHours = Number(getEnvValue(runtimeEnv, 'OPS_MIN_ACTIVITY_HOURS') || 24);
  const hours = Number.isFinite(thresholdHours) && thresholdHours > 0 ? thresholdHours : 24;
  const result = await getLibsql().execute(`
    select max(latest_at) as latest_at
    from (
      select max(updated_at) as latest_at from operation_record
      union all
      select max(updated_at) as latest_at from ingredient_record
      union all
      select max(updated_at) as latest_at from product_record
      union all
      select max(updated_at) as latest_at from login_attempt
    )
  `);
  const latestAt = parseSqliteTimestamp(result.rows[0]?.latest_at);

  if (!latestAt) {
    return {
      ok: false,
      title: '최근 활동 점검 실패',
      detail: '운영 기록 또는 로그인 시도 기록을 찾지 못했습니다.',
    };
  }

  const ageHours = (Date.now() - latestAt.getTime()) / (60 * 60 * 1000);
  if (ageHours <= hours) {
    return {
      ok: true,
      title: '최근 활동 점검',
      detail: `마지막 활동 ${latestAt.toISOString()} (${Math.round(ageHours * 10) / 10}시간 전)`,
    };
  }

  return {
    ok: false,
    title: '최근 활동 없음',
    detail: `${Math.round(ageHours * 10) / 10}시간 동안 운영 기록 또는 로그인 시도 기록이 없습니다. 의도된 휴무가 아니라면 접속/DB 상태를 확인하세요.`,
  };
}

export async function runScheduledOpsChecks(runtimeEnv?: ScheduledEnv) {
  const startedAt = new Date().toISOString();
  const checks = await Promise.all([checkDataIntegrity(), checkRecentActivity(runtimeEnv)]);
  const failedChecks = checks.filter((check) => !check.ok);

  console.log({
    event: 'ops_checks_completed',
    startedAt,
    failed: failedChecks.length,
    checks,
  });

  if (failedChecks.length === 0) return;

  const lines = [
    '[신칼 운영 알림]',
    `발생 시각: ${startedAt}`,
    ...failedChecks.map((check) => `- ${check.title}: ${check.detail}`),
  ];
  await sendDiscordMessage(getEnvValue(runtimeEnv, 'DISCORD_WEBHOOK_URL'), lines.join('\n'));
}
