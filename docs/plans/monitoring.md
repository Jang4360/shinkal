# 모니터링 구현 계획 (지금 단계)

> 상태: 1차 구현 진행 중
> 대상: 신칼 운영 관측 — Cloudflare(Workers) + Turso + Sentry + UptimeRobot + Discord
> 관련 문서: [알림·장애 매뉴얼](../operate/alarm_manual.md), [운영 학습](../operate/study.md), [ADR 0002 모니터링](../adr/0002-monitoring-observability.md)
> 이 문서는 **실행용 체크리스트**다. `[x]`로 체크하며, 각 항목에 **성공 기준**과 **위치**(`[코드]`/`[플랫폼]`/`[외부]`)를 적었다.

## 0. 범위

[alarm_manual §6](../operate/alarm_manual.md)에서 **"지금"** 으로 분류한 것 + 사용자 요청(요청 한도 50/80% 알림, 프론트 RUM)까지를 구현 대상으로 한다. **"나중/보류"**(분산 추적, 온콜 로테이션, 풀 E2E 합성, 로그 장기보존)는 제외.

원칙 한 줄: **알림은 절대 건수 + 신호 부재로, 추적은 requestId로, 도구는 무료 네이티브 우선.**

---

## A. 공통 backbone

- [x] **requestId 진입 미들웨어** `[코드]` — `app.use('*')`에서 요청당 id 1회 생성 → `c.set('requestId', id)` → 응답 헤더 `X-Request-Id` → 모든 로그/에러가 이 id 재사용. 성공: 한 요청의 모든 로그가 동일 id로 묶임.
- [x] **Cloudflare Workers Observability 활성** `[코드]` — `wrangler.toml`에 `[observability] enabled = true`. 성공: 대시보드에서 로그·메트릭 조회됨.
- [x] **구조화 로그 일원화** `[코드]` — `api_error`, `readiness_failed`, `ops_checks_completed`를 객체 로그로 남겨 Cloudflare Logs에서 필드 검색 가능.

## B. 에러 트래킹 (Sentry)

- [x] **`@sentry/hono` + `@sentry/cloudflare` 설치** `[코드]` — Hono Cloudflare middleware로 `env.SENTRY_DSN`을 읽는다. `nodejs_compat` 확인 완료. 성공: 의도적 예외가 Sentry에 도착.
- [x] **5xx/잡히지 않은 예외만 capture** `[코드]` — `status >= 500`만 `captureException`. **4xx 비즈니스 거부**(`VERSION_CONFLICT`·`CATALOG_CHANGED`·`VALIDATION_ERROR`·`INVALID_PASSWORD`·`DUPLICATE`)는 capture 금지. 성공: 충돌 4xx가 Sentry에 안 쌓임.
- [x] **Sentry 태그/컨텍스트** `[코드]` — `requestId`, `domain`, `operation` 태그와 `api_error` 컨텍스트 추가. 성공: Sentry 이슈와 알림에 requestId가 보여 로그로 점프 가능.
- [ ] **Alert Rule → Discord** `[플랫폼]` — 신규 이슈 1건 즉시 / 10분 내 동일 N건(절대 건수, 비율 아님)일 때 Discord로. 성공: 5xx 발생 시 Discord 알림(requestId 포함).

## C. 헬스 / 생존

- [x] **`/health` (liveness)** `[코드]` — DB 안 건드리고 `200`만. 앱 프로세스 생존 확인용. 성공: DB 다운에도 앱이 살아있으면 200.
- [x] **`/ready` (readiness)** `[코드]` — `SELECT 1`로 DB 확인, 실패 시 `503`. 성공: DB 끊으면 `/ready`만 503, `/health`는 200(B/C 구분).
- [x] **UptimeRobot HTTP 모니터** `[외부]` — `/health` 5분 핑(다운 감지). 성공: 사이트 내리면 5분 내 Discord/이메일 알림.
- [ ] **UptimeRobot heartbeat** `[외부/보류]` — Free 플랜에서는 유료 기능이라 현재 제외. 무트래픽성 신호는 D의 Worker cron 점검으로 대체한다.

## D. Cron 기반 알림 (Cloudflare Cron Trigger 1개로 통합)

- [x] **Cron 트리거 + `scheduled()` 핸들러** `[코드]` — `wrangler.toml [triggers] crons` 설정. 매일 03:00 KST 실행.
- [x] **(D-1) Dead Man's Switch — 최근 활동 없음** `[코드]` — 최근 24시간 운영 기록 또는 로그인 시도 기록이 없으면 Discord 알림. UptimeRobot heartbeat 유료 기능의 무료 대체 신호로 사용.
- [x] **(D-2) 데이터 무결성 감사** `[코드]` — 일 1회 핵심 불변식 검증 쿼리 → 위반 행 있으면 Discord. 예: 음수 사용량/단가/재고, `version < 1`, 음수 정렬값.
- [ ] **(D-3) 무료 요청 한도 50%/80% 알림** `[코드/보류]` — Cloudflare GraphQL Analytics로 월 요청수를 조회해야 한다. 구현 전 Worker 런타임에 `CF_ACCOUNT_ID`, `CF_ANALYTICS_TOKEN`이 필요하고, 중복 방지 저장소(KV 또는 DB 테이블)를 정해야 한다.

## E. 프론트엔드 관측 (RUM)

- [x] **Sentry 브라우저 SDK** `[코드]` — `apps/web`에 `@sentry/react` 초기화. `VITE_SENTRY_DSN`이 있을 때만 활성화. 성공: 프론트에서 던진 에러가 Sentry에 뜸.
- [ ] **Web Vitals 수집** `[플랫폼/보류]` — `workers.dev` 주소는 Cloudflare Web Analytics hostname 등록에서 막힐 수 있다. 커스텀 도메인을 붙이면 Cloudflare Web Analytics를 우선 사용한다.

## F. 공통 유틸

- [x] **Discord 알림 유틸** `[코드]` — Worker cron 점검과 GitHub Actions 백업에서 webhook POST 사용. 성공: 자체 알림은 한글 메시지로 발송.
- [ ] **알림 문구 표준화** `[코드/플랫폼]` — 자체 알림은 한글화 완료. Sentry/UptimeRobot 기본 Discord 알림은 서비스 기본 포맷이라 완전 한글화하려면 relay Worker가 필요하다.

---

## G. 데이터 백업 / 복구 (관측과 별개지만 같은 안전망)

> 마이그레이션은 "스키마 구조" 버전 관리고, 백업은 "행 데이터" 복구용이라 **다른 것**이다. 현재 백업은 GitHub Actions + R2로 1차 구현했고, 수동 실행 검증까지 완료했다.

- [x] **백업 잡 = GitHub Actions 스케줄** `[CI]` — Worker는 CLI 실행이 안 되므로, 주기 워크플로가 `turso db shell <db> .dump`로 SQL 덤프를 만든다. 매주 일요일 03:00 KST 실행 + 수동 실행 가능.
- [x] **덤프 보관 = Cloudflare R2(비공개 버킷)** `[외부]` — 덤프를 R2에 업로드(S3 호환 API), 파일명에 날짜. 현재 버킷: `shinkal-db-backups`.
- [x] **백업 알림 = Discord 직접 발송** `[CI]` — UptimeRobot heartbeat는 유료라 제외. GitHub Actions가 성공/실패를 Discord webhook으로 한글 메시지 발송.
- [ ] **복구 절차 문서화** `[문서]` — 새 Turso DB 생성 후 `turso db shell <db> < dump.sql`로 import하는 절차를 런북에. 성공: 덤프 1개로 빈 DB 복원 검증.

참고/제한:
- **R2 무료**: 약 10GB 저장 + **egress 무료**, 기본 비공개. 우리 덤프는 작아 충분(상업적 사용 허용). 정확 수치는 Cloudflare 요금 페이지 확인.
- **Turso 플랫폼 백업/PITR(시점복원)** 은 플랜 의존 — 무료 티어는 보존창이 짧을 수 있어, 위 외부 덤프가 추가 방어선이다.
- 덤프엔 **실제 운영 데이터**가 들어가니 반드시 **비공개 저장소**(공개 GitHub repo 금지). GitHub private repo도 가능하나 용량/히스토리 비대 문제로 R2 권장.
- UptimeRobot heartbeat는 유료 플랜 기능이라 현재 제외. 백업 성공/실패는 GitHub Actions에서 Discord webhook으로 직접 알린다.
- 백업용 GitHub Actions Secrets: `TURSO_DATABASE_NAME`, `TURSO_API_TOKEN`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_BUCKET`, `DISCORD_WEBHOOK_URL`.

## 검증 시나리오

- [ ] 일부러 5xx 던지기 → Discord 알림 + Sentry에 requestId 태그 + 그 id로 CF 로그 검색됨.
- [ ] DB 연결 끊고 `/ready` 503 / `/health` 200 확인.
- [ ] 불변식 위반 행 심고 cron 실행 → 감사 알림.
- [ ] 무트래픽(또는 최신 기록 24h+ 과거) 모의 → DMS 알림.
- [ ] 요청수 50/80% 경계 모의 → 각 1회 알림(중복 없음).
- [ ] 프론트에서 강제 throw → 브라우저 에러가 Sentry에 수집.

## 필요한 환경변수/시크릿 (추가분)

| 키 | 용도 | 위치 |
|---|---|---|
| `SENTRY_DSN` | Cloudflare Workers 백엔드 에러 전송 | Worker 시크릿 |
| `DISCORD_WEBHOOK_URL` | Worker cron 자체 알림 + 백업 알림 | Worker 시크릿, GitHub Actions Secret |
| `VITE_SENTRY_DSN` | React 브라우저 에러 전송. Vite 특성상 public 값 | GitHub Actions Secret |
| `CF_ANALYTICS_TOKEN` | Cloudflare Analytics 조회 | Worker 시크릿 |
| `CF_ACCOUNT_ID` | Cloudflare Analytics 조회 대상 계정 | Worker 시크릿 |
| `OPS_MIN_ACTIVITY_HOURS` | 최근 활동 없음 알림 임계값. 기본 24 | `wrangler.toml` vars |
| `TURSO_DATABASE_NAME` | 백업 대상 DB 이름. 예: `shinkal-prod` | GitHub Actions Secret |
| `TURSO_API_TOKEN` | Turso CLI 백업 인증 | GitHub Actions Secret |
| `R2_ACCESS_KEY_ID` | R2 업로드 인증 | GitHub Actions Secret |
| `R2_SECRET_ACCESS_KEY` | R2 업로드 인증 | GitHub Actions Secret |
| `R2_ENDPOINT` | R2 S3 API endpoint | GitHub Actions Secret |
| `R2_BUCKET` | R2 버킷 이름 | GitHub Actions Secret |

주의: 채팅/문서/커밋에 실제 토큰 값을 적지 않는다. Discord webhook과 Cloudflare API token은 노출 시 재발급한다.

## 범위 밖 (이번 미포함, 근거는 alarm_manual §6)

분산 추적(span)·OpenTelemetry, 온콜 로테이션(PagerDuty), 풀 E2E 합성(Checkly), 로그 장기보존(Logpush→R2), 샘플링. → "문제 신호가 오면 그때 한 칸 키운다."
