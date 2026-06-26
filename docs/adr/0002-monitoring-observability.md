# ADR 0002: 모니터링/관측 스택 (Sentry + Cloudflare 네이티브 + UptimeRobot + Discord)

## 상태

Accepted

## 날짜

2026-06-26

## 배경

신칼 체크리스트는 실제 매장(광화문·서면)에서 매일 쓰는 서비스로 배포되었다([ADR 0001](./0001-api-db-stack.md)). 기능이 동작하는 것과 별개로, 사용자가 들어온 뒤에는 **장애를 먼저 감지하고 원인을 추적해 고치는 환경**이 필요하다.

제약 조건은 [ADR 0001](./0001-api-db-stack.md)과 같다.

| 항목 | 조건 |
|---|---|
| 규모 | 사용자 ~10명, 지점 2개, 트래픽 하루 수십 요청 수준(저트래픽) |
| 실행 환경 | Cloudflare Workers(서버리스/엣지) + 정적 assets, Turso(libSQL, HTTP) |
| 비용 | 취업 준비 중 개인 프로젝트지만 **실제 영업 매장이 사용**(상업적). 가능한 무료, 상업적 사용 허용 필요 |
| 운영 인력 | 1인 |

이전 프로젝트에서는 Prometheus·Grafana·Loki를 썼으나, 그때는 RAM이 큰 상주 VM이 있었다. 지금은 상주 프로세스가 없는 서버리스라 같은 스택이 맞지 않는다.

## 결정

다음 관측 스택을 채택한다.

| 영역 | 선택 | 비고 |
|---|---|---|
| 에러 트래킹 | **Sentry** (`@sentry/cloudflare`, 브라우저 SDK) | 5xx/예외만 capture, requestId 태그 |
| 로그 | **Cloudflare Workers Logs**(내장) + 구조화 로그 | 보존 3일(무료) |
| 메트릭 | **Cloudflare Workers Observability**(내장) + **Turso 대시보드** | 요청수·에러·CPU·Duration·subrequest |
| 생존 감시 | **UptimeRobot**(외부) | `/health`(liveness) 핑 + heartbeat |
| 알림 전달 | **Discord webhook** | Sentry Alert Rule + cron |
| 주기 작업 | **Cloudflare Cron Trigger** | 무트래픽(DMS)·데이터 감사·한도 알림 |
| 추적 키 | **requestId(진입 미들웨어)** | 로그·Sentry·응답 헤더 공통 |

핵심 설계 원칙:

- **알림은 "사고"만**: 5xx·예외·DB다운·앱다운·무트래픽만. 4xx 비즈니스 거부는 로그만.
- **저트래픽 맞춤 알림**: 비율·백분위 대신 **절대 건수 + 신호 부재(Dead Man's Switch)**.
- **추적의 뼈대는 requestId**: 알림 ↔ Sentry ↔ 로그를 하나의 id로 연결.
- **무료 네이티브 우선, 오버스펙 금지**: 필요해질 때 한 칸씩 키운다.

## 선택 이유

### Sentry (에러 트래킹)

| 이유 | 설명 |
|---|---|
| 서버리스 적합 | Cloudflare Workers 공식 SDK(`@sentry/cloudflare`). push 방식이라 상주 프로세스 불필요 |
| 진단력 | 스택 트레이스 + 요청 컨텍스트 + 같은 에러 묶음(grouping) 제공 → "어디서·왜"의 1차 답 |
| 연결성 | `setTag('requestId')`로 우리 로그와 cross-link, 프론트 SDK로 RUM까지 한 조직에서 |
| 비용 | 무료 플랜으로 이 규모 충분(에러 quota 내), 상업적 사용 허용 |

### Cloudflare 네이티브(로그·메트릭·cron)

| 이유 | 설명 |
|---|---|
| 0 설치 | 이미 Cloudflare에 배포 → 로그·메트릭·Cron이 플랫폼에 내장 |
| 서버리스 정합 | pull 방식 Prometheus와 달리, 엣지 실행 모델에 맞는 내장 관측 |
| Cron Trigger | 무트래픽 감지·데이터 감사·한도 알림을 상주 서버 없이 주기 실행 |

### UptimeRobot (외부 생존 감시)

| 이유 | 설명 |
|---|---|
| 사각지대 보완 | 앱이 통째로 죽으면 Sentry조차 침묵 → **바깥에서** 찔러야 감지 가능 |
| 무료·간단 | 가입 후 `/health` URL 등록만, heartbeat로 무트래픽도 보조 |

### Discord (알림 전달) / requestId (추적)

- Discord: 1인 운영엔 webhook 하나로 충분. PagerDuty식 escalation은 과함.
- requestId: 진입 미들웨어에서 1회 생성해 로그·Sentry·응답 헤더에 박아, 사고를 끝까지 추적하는 연결고리.

## 대안 검토

| 대안 | 장점 | 제외/보류 이유 |
|---|---|---|
| Prometheus + Grafana + Loki | 강력·유연, 이전 경험 | **상주 VM 필요**(pull 방식). 서버리스에 부적합, 1인 운영 부담 |
| Datadog / New Relic | 올인원 APM | 유료 중심, 이 규모엔 과한 비용·복잡도 |
| Grafana Cloud(무료 티어) | 매니지드 Grafana/Loki/Tempo | 설정 복잡·계측 부담, 내장으로 충분 |
| OpenTelemetry(분산 추적) | 표준 트레이싱 | 단일 서비스(한 홉)라 지금은 과함. requestId 상관관계로 대체 |
| Better Stack / Logflare | 로그·업타임 통합 | Cloudflare 내장 로그 + UptimeRobot로 충분, 도구 수 최소화 |
| 비율·백분위 기반 알림 | 큰 시스템 표준 | **저트래픽에선 오작동**(5xx 1건이 비율 폭증, p95 표본 부족) → 절대 건수+DMS로 대체 |
| 알림을 앱 내부에 두기 | 단순 | 앱이 죽으면 알림도 죽음 → 외부(UptimeRobot) 필요 |

## 결과

- 사용자 제보 이전에 **모니터링이 먼저 감지** → Discord 알림(requestId 포함) → 로그·Sentry로 추적 → 수정하는 흐름이 성립한다.
- 무료·서버리스 네이티브 중심이라 운영 비용·부담이 낮고, 상업적 사용 약관에도 안전하다.
- 이 구조가 **무엇을 못 보는지**(분산 추적, 풀 E2E, 장기 로그 등)를 [alarm_manual §6](../operate/alarm_manual.md)에 명시해, "알고 미룬다"를 유지한다.

## 후속 작업

| 작업 | 설명 |
|---|---|
| 구현 | requestId 미들웨어 / Sentry(5xx만) / `/health`·`/ready` / Cron(DMS·감사·한도) / Discord 유틸 / 프론트 RUM → [모니터링 구현 계획](../plans/monitoring.md) |
| 시크릿 등록 | `SENTRY_DSN`, `DISCORD_WEBHOOK_URL`, `CF_ANALYTICS_TOKEN` (Worker 시크릿) |
| 백업 | 데이터 복구용 Turso 덤프는 GitHub Actions가 매일 R2에 저장한다. 복구 절차는 [백업 / 복구 런북](../operate/backup_restore.md) 참고 |
| 재검토 시점 | 트래픽이 일 수천 건↑ 또는 서비스가 여러 개로 분리될 때 — 분산 추적·온콜·요약 테이블 재검토 |
