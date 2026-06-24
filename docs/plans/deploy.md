# 배포 계획: Cloudflare (단일 Worker + 정적 assets) + GitHub Actions CI/CD

> 상태: 계획
> 대상: 신칼 체크리스트 — `apps/web`(Vite React) + `apps/api`(Hono) + Turso(libSQL)
> 호스트: **Cloudflare** (Vercel 미사용). DB는 기존 Turso 그대로.

## 1. 아키텍처

```
사용자 → https://shinkal.<도메인>  (Cloudflare 엣지)
   └─ 단일 Worker
        ├─ /api/* , /health  → Hono app (Turso HTTP로 쿼리)
        └─ 그 외 모든 경로     → 정적 assets(apps/web/dist) + SPA fallback(index.html)
```

- **프론트**: `apps/web` 빌드(`dist`)를 Worker의 **static assets 바인딩**으로 서빙(CDN). 정적 요청은 무료·무제한, Worker 요청 수에 안 잡힘.
- **백엔드**: `apps/api`의 Hono 앱을 **Worker로 번들**해 `/api/*` 처리. 같은 도메인이라 쿠키/CORS 단순.
- **DB**: Turso. Worker에서는 **`@libsql/client/web`**(fetch 기반)로 접속.

## 2. 코드 변경 (구현 체크리스트)

- [ ] **Hono `app`을 진입점에서 분리** — `apps/api/src/app.ts`에 라우트가 붙은 `app`만 export(현재 `server.ts`의 라우트 이동). `@hono/node-server`/`serve(...)` import는 여기서 제거.
- [ ] **로컬(Node) 진입점 유지** — `apps/api/src/server.ts`는 `app`을 import해 `serve(...)`로 로컬 dev만 담당.
- [ ] **Worker 진입점 신설** — `apps/api/src/worker.ts`:
  ```ts
  import app from './app';
  export default {
    fetch(request: Request, env: any, ctx: any) {
      const url = new URL(request.url);
      if (url.pathname.startsWith('/api') || url.pathname === '/health') {
        return app.fetch(request, env, ctx);
      }
      return env.ASSETS.fetch(request); // 정적 + SPA fallback
    },
  };
  ```
- [ ] **libSQL 클라이언트 Workers 호환** — `@libsql/client` → **`@libsql/client/web`** import. (drizzle `drizzle-orm/libsql`는 그대로 사용 가능)
- [ ] **env/DB 초기화 Workers 호환** — Workers는 `process.env`가 import 시점에 비어 있을 수 있다.
  - `wrangler.toml`에 `compatibility_flags = ["nodejs_compat"]` 설정 시 `process.env`가 시크릿/vars로 채워짐. 그래도 **DB 클라이언트는 지연 초기화(lazy)** 로 바꾼다:
    ```ts
    let _db; export function getDb() { if (!_db) { assertEnv(); _db = drizzle(createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN })); } return _db; }
    ```
  - 기존 `db` 직접 사용처를 `getDb()`로 교체(서버 라우트 일괄). `env.ts`의 `dotenv config()`는 Node(dev)에서만 의미 있고 Workers에선 무시됨(무해).
- [ ] **wrangler.toml 작성** (`apps/api/` 또는 루트):
  ```toml
  name = "shinkal"
  main = "apps/api/src/worker.ts"
  compatibility_date = "2024-09-23"
  compatibility_flags = ["nodejs_compat"]

  [assets]
  directory = "apps/web/dist"
  binding = "ASSETS"
  not_found_handling = "single-page-application"

  [vars]
  COOKIE_SECURE = "true"
  COOKIE_SAME_SITE = "Lax"
  # APP_ORIGIN 불필요(같은 도메인). 시크릿은 vars 아님(아래 wrangler secret).
  ```
- [ ] **쿠키 설정 확인** — 같은 도메인이라 `SameSite=Lax` + `Secure=true`로 동작(현 env 기반 그대로). CORS 미들웨어는 같은 도메인이면 불필요(있어도 무해).
- [ ] **빌드 파이프라인** — 배포 전 `apps/web`을 `vite build`해 `dist` 생성(assets가 이 폴더를 업로드).
- [ ] **마이그레이션** — `drizzle-kit`/`migrate.ts`는 Worker가 아니라 **CI 또는 로컬에서 Turso로** 적용(런타임과 분리).
- [ ] `pnpm check` 통과, 로컬 `wrangler dev`로 `/api` + 정적 동시 동작 확인.

## 3. 환경변수 / 시크릿

| 위치 | 키 | 용도 |
|---|---|---|
| **Cloudflare Worker 시크릿** (`wrangler secret put`) | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `APP_PASSWORD`, `AUTH_TOKEN_SECRET` | 런타임. 코드 노출 금지 |
| **Cloudflare Worker vars** (`wrangler.toml [vars]`) | `COOKIE_SECURE=true`, `COOKIE_SAME_SITE=Lax` | 비민감 설정 |
| **GitHub Actions 시크릿** | `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` | CI가 배포할 때 |
| **GitHub Actions 시크릿** (마이그레이션 단계용) | `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` | CI에서 `drizzle migrate` 실행 |

> 런타임 시크릿(Cloudflare)과 CI 시크릿(GitHub)은 **별개**다. 둘 다 등록해야 한다.

## 4. CI/CD — GitHub Actions (권장)

**권장 이유**: push 시 CI가 `pnpm check`(타입체크+빌드)로 게이트한 뒤에만 배포 → 깨진 코드 자동 배포 방지. Cloudflare 배포는 `wrangler`로 자동화(수동 `wrangler deploy` 반복 불필요).

- **`.github/workflows/ci.yml`** (PR + push): pnpm 설치 → `pnpm check`(api tsc + web build). 게이트 역할.
- **`.github/workflows/deploy.yml`** (main push, ci 통과 후):
  1. pnpm 설치
  2. `pnpm --filter @shinkal/web build` (dist 생성)
  3. (선택) Turso 마이그레이션: `pnpm --filter @shinkal/api db:migrate` (GitHub 시크릿의 TURSO_* 사용)
  4. `cloudflare/wrangler-action@v3`로 `wrangler deploy` (CLOUDFLARE_API_TOKEN/ACCOUNT_ID 사용)

> 마이그레이션 자동 적용은 편하지만 잘못된 마이그레이션이 프로덕션에 바로 반영될 위험이 있다. 소규모라 자동으로 두되, 위험한 변경은 PR 리뷰로 거른다. 더 보수적으로 가려면 마이그레이션을 수동/별도 워크플로(`workflow_dispatch`)로 분리.

```yaml
# deploy.yml (요지)
on: { push: { branches: [main] } }
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @shinkal/api check
      - run: pnpm --filter @shinkal/web build
      - run: pnpm --filter @shinkal/api db:migrate
        env:
          TURSO_DATABASE_URL: ${{ secrets.TURSO_DATABASE_URL }}
          TURSO_AUTH_TOKEN: ${{ secrets.TURSO_AUTH_TOKEN }}
      - uses: cloudflare/wrangler-action@v3
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: deploy
```

## 5. 사용자(운영자) 직접 작업

| # | 작업 | 위치 |
|---|---|---|
| 1 | Cloudflare **API 토큰** 발급(Workers 편집 권한) | Cloudflare 대시보드 → My Profile → API Tokens |
| 2 | **Account ID** 확인 | Workers & Pages 화면 우측/계정홈 |
| 3 | Worker **런타임 시크릿** 등록 | `wrangler secret put TURSO_DATABASE_URL` 등 4개 (또는 대시보드) |
| 4 | **GitHub 시크릿** 등록 | repo Settings → Secrets and variables → Actions (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, TURSO_DATABASE_URL, TURSO_AUTH_TOKEN) |
| 5 | 최초 1회 로컬 검증 | `wrangler login` → `wrangler deploy` 또는 `wrangler dev` |
| 6 | (선택) **커스텀 도메인** 연결 | 없으면 `*.workers.dev` 사용 |
| 7 | `AUTH_TOKEN_SECRET` 운영용 강한 값 확인(32자+) | 시크릿 |
| 8 | 기존 **Vercel 배포 중지/방치** | Vercel |

## 6. 검증 / 롤백

- 배포 후: 로그인(1234) → 각 체크리스트 저장/조회 → 통계 조회 동작 확인.
- 쿠키: 응답에 `Secure; SameSite=Lax; HttpOnly` 확인, 새로고침 후 세션 유지.
- 롤백: Cloudflare 대시보드의 이전 버전(Deployments)으로 즉시 롤백 가능. 마이그레이션은 별도 롤백 마이그레이션 필요.

## 7. 주의

- Worker 런타임은 Node가 아님 → Node 전용 API/패키지 사용 금지(현재 jose·hono/cookie·crypto.randomUUID는 호환).
- Cloudflare/Turso 각자의 무료 한도 내 운영(Workers 10만 req/일·정적 무제한 / Turso 무료 티어).
- 상업적 사용 가능(Cloudflare 무료 티어 상업 허용).
