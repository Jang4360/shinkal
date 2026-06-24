# MVP1 구현 계획 (체크리스트)

> 상태: 진행 중
> 대상: 신칼 체크리스트 MVP1 전 과정 (DB · 백엔드 · API · 프론트 · UI/UX · 검증 · 배포)
> 이 문서는 **실행용 체크리스트**다. 구현 완료 항목은 `[x]`로 체크한다. 각 항목에는 **성공 기준**과 **참조 문서**를 함께 적었다.

## 0) 참조 문서 맵 (무엇을 볼 때 어디를 보나)

| 볼 것 | 문서 |
|---|---|
| 기능 요구사항·정책(인증/저장/동시성/이력) | [SRS](../srs/checklist-management-srs.md) |
| DB 테이블·컬럼·제약(11개, 참조 모델, 카탈로그 버전) | [ERD](../erd.md) |
| 엔드포인트·요청/응답·에러 envelope·에러 대응표 | [API 명세](../api.md) |
| 디자인 토큰·컴포넌트·deslop 규칙 | [UI/UX](../ui_ux.md) |
| 화면별 구성요소·버튼·동작(S1~S6) | [화면 명세](../화면명세.md) |
| 기술 스택·설계 원칙 | [ADR 0001](../adr/0001-api-db-stack.md) |
| 범위/마일스톤 | [MVP1 계획](./mvp1.md) |
| 범위 밖(집계/추이) | [MVP2 계획](./mvp2.md) |

## 0-1) 확정 사항 요약 (구현 시 반드시 반영)

- DB: 체크리스트 기록은 record/line 구조, **참조 모델**(이름은 JOIN, 그날 입력값은 line에 동결), 마스터 **soft delete만**(하드 삭제 금지). (ERD §0)
- 동시성: 기록 `version` + 마스터 행 `version` + 도메인 `catalogVersion`. 자동 머지 금지. 설정↔체크리스트는 **설정 우선**. (SRS §11)
- 인증: 공용 비밀번호 **env(`APP_PASSWORD=1234`)**, **단일 토큰(refresh 없음) 만료 7일**, httpOnly 쿠키 권장, 로그아웃은 클라이언트 토큰 폐기. (API §1)
- 총점수 = 체크 수(1점/항목, 서버 계산). 식자재 판정 NOT NULL(정상/과다/부족). (SRS §6.2, §7.1)
- 식자재: 진입 시 전회차 단가 즉시 표시, 단가 상태 텍스트/상승집계는 화면 계산. (SRS §7.2)
- 화면: S1 로고 스플래시 로그인 / 사이드탭 상시(운영+12 들여쓰기, 하단 로그아웃) / 체크리스트 변경감지 저장 + 이탈 가드 / 운영·식자재·공산품 PDF / 설정 인라인 편집(+추가·연필·휴지통·삭제 모달). (화면명세 S0~S6)
- UI/UX: 흰 배경, Pretendard, 상단 빨강 stroke 제거, 제목 20px, 토스식 버튼, deslop. (UI/UX)
- 집계는 MVP1 범위 밖(MVP2). (mvp2.md)

---

## 1) 프로젝트 구조 · 환경 (M0)

- [x] `apps/web`(React/Vite), `apps/api`(TypeScript) 모노레포로 재구성 — 성공기준: 두 앱이 각각 dev로 기동되고 web→api 호출이 로컬에서 성공. (참조: ADR, mvp1 §M0)
- [x] Drizzle ORM + Drizzle Kit + Turso/libSQL 연결 설정(`drizzle.config.ts`) — 성공기준: `drizzle-kit` 마이그레이션 생성/적용이 동작. (참조: ADR)
- [x] 환경변수 정리: `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `APP_PASSWORD`, `AUTH_TOKEN_SECRET` — 성공기준: 서버에서만 로드되고 프론트 번들에 노출 안 됨. (참조: ADR, API §0)
- [ ] Vercel 배포 환경변수 등록 — 성공기준: 프리뷰 배포에서 env가 주입됨. (참조: mvp1 §M0)

## 2) DB 스키마 · 시드 (M1)

- [x] Drizzle 스키마 정의 — 성공기준: 모든 테이블/컬럼/타입이 ERD와 1:1 일치. (참조: ERD)
  - [x] `branch` / `operation_record` / `operation_check`
  - [x] `ingredient_category` / `ingredient_item` / `ingredient_unit_option` / `ingredient_record` / `ingredient_line`
  - [x] `product_item` / `product_record` / `product_line`
- [x] 제약 반영: `UNIQUE(branch_id, business_date, checklist_id)`(운영), `UNIQUE(branch_id, business_date)`(식자재/공산품), `UNIQUE(record_id, item_id)`, `UNIQUE(unit, value)`, 각 `version` 기본값 — 성공기준: 중복 insert가 DB에서 거부됨. (참조: ERD 각 §비고)
- [x] 인덱스: `(branch_id, business_date)`, `ingredient_line(item_id)` 등 전회차 단가/조회용 — 성공기준: 조회 쿼리에서 인덱스 사용 확인. (참조: ERD §8 비고, SRS §13)
- [x] 마이그레이션 파일 생성·적용 — 성공기준: 빈 DB에 마이그레이션만으로 전체 스키마 구성. (참조: ADR)
- [x] 시드 적재: 지점(광화문/서면), 식자재 카테고리·품목·단위옵션, 공산품 품목 — 성공기준: SRS §7.4/§7.3/§8.3 시드가 그대로 들어감. (참조: SRS §7.4, §7.3, §8.3)

## 3) 백엔드 공통 (M2, M7)

- [x] 에러 envelope 미들웨어: `code/domain/operation/message/requestId/timestamp/field/details` — 성공기준: 모든 에러가 이 형식으로 반환되고 로그에 `[requestId] domain.operation code http` 한 줄 남음. (참조: API §0 에러)
- [x] 인증: `POST /api/auth/login`(env 비번 검증→토큰 발급, 7일), 보호 미들웨어 — 성공기준: 1234 입력 시 토큰 발급/그 외 `INVALID_PASSWORD`, 토큰 없으면 `UNAUTHORIZED`. (참조: API §1, 화면명세 S1)
- [x] 토큰 저장(httpOnly 쿠키 권장) — 성공기준: 토큰이 JS에서 직접 읽히지 않음. (참조: API §1)
- [x] 낙관적 락 유틸: 기록 `version`/마스터 `version`/도메인 `catalogVersion` 검증·증가 — 성공기준: version 불일치 시 `VERSION_CONFLICT`, catalogVersion 불일치 시 `CATALOG_CHANGED`. (참조: SRS §11, API §0 동시성)
- [x] 빈 값/검증 규칙(수치 빈값 허용, `verdict` 후보값 검증) — 성공기준: `verdict` 밖 값은 `VALIDATION_ERROR`(field=verdict). (참조: SRS §11, §7.1)

## 4) 백엔드 API — 도메인별 (M3~M6)

- [x] 지점: `GET /api/branches` — 성공기준: 광화문/서면 반환. (참조: API §2)
- [x] 운영: `GET /operations/templates`, `GET /operations`, `PUT /operations` — 성공기준: 템플릿 12종 반환; 저장 시 서버가 `totalScore`(체크수)/`totalItems` 계산; version 충돌 처리. (참조: API §3, SRS §6)
- [x] 식자재: `GET /ingredients`(활성 품목 전체 + **품목별 전회차 단가** + catalogVersion), `PUT /ingredients` — 성공기준: 신규에도 전회차 단가 채워짐; 저장 시 `prevUnitPrice` 서버 스냅샷; version+catalogVersion 검증. (참조: API §4, SRS §7)
- [x] 공산품: `GET /products`, `PUT /products` — 성공기준: 활성 품목 전체 행 반환; 저장/충돌 처리. (참조: API §5, SRS §8)
- [x] 설정(식자재): 카테고리·품목·단위옵션 CRUD + reorder — 성공기준: 변경 시 식자재 `catalogVersion` +1; soft delete; `DUPLICATE`(unit,value) 처리. (참조: API §6, SRS §9.1)
- [x] 설정(공산품): 품목 CRUD + reorder — 성공기준: 변경 시 공산품 `catalogVersion` +1; soft delete. (참조: API §7, SRS §9.2)
- [x] 참조 모델 조회: 체크리스트 GET이 이름을 마스터 JOIN으로 반환 — 성공기준: 설정에서 이름 변경 후 과거 기록 조회 시 새 이름으로 표시. (참조: ERD §0, API §4/§5)

## 5) 프론트 — 디자인 시스템 · 공통 셸 (UI/UX, S0/S1)

- [x] 흰 배경 적용(크림 제거) — 성공기준: 페이지/카드 배경 흰색. (참조: UI/UX §1) *(현 `src/styles.css` 적용 완료; `apps/web` 이전 시 유지)*
- [x] 상단 빨강 stroke 제거 — 성공기준: topbar/hero/inspector에 빨강 top border 없음. (참조: UI/UX §1)
- [x] Pretendard 폰트 적용 — 성공기준: 전 화면 Pretendard 렌더. (참조: UI/UX §2)
- [x] 체크리스트 제목 20px로 축소·일관화 — 성공기준: `매장 오픈 [홀]` 등 제목 20px. (참조: UI/UX §1, 화면명세 S2)
- [x] deslop(굵기 600/700, 중립 회색 테두리, 얕은 그림자) — 성공기준: font-weight 800~950·빨강 틴트 테두리 없음. (참조: UI/UX §2)
- [x] 토스식 버튼(둥근 모서리·press 피드백) — 성공기준: 버튼 radius 12, active scale. (참조: UI/UX §3)
- [x] 디자인 토큰을 `apps/web`로 이관·정리 — 성공기준: 색/타이포/간격 토큰이 한곳에서 관리. (참조: UI/UX §2)
- [x] S1 로그인(스플래시): 신칼 로고 대형 + 서비스명 + 비번 입력 — 성공기준: 1234 진입 성공/오답 인라인 에러; 로고 96~128px. (참조: 화면명세 S1)
- [x] S0 사이드탭 상시 노출: 운영(+12 들여쓰기) · 식자재 · 공산품 · 설정 + **하단 로그아웃** — 성공기준: 12종이 들여쓰기로 보이고 선택 인디케이터 동작, 로그아웃 시 S1로 이동. (참조: 화면명세 S0)
- [x] 상단바: 지점 드롭다운 + 영업일 선택, 변경 시 재조회 — 성공기준: 지점/날짜 바꾸면 해당 화면 데이터 갱신. (참조: 화면명세 S0)
- [x] 라우팅 + 보호 라우트(토큰 없으면 S1) — 성공기준: 미인증 접근 시 S1로 리다이렉트. (참조: 화면명세 S0/S1)
- [ ] 이탈 가드: 미저장 변경 시 모달([저장]/[저장 안 함]/[취소]) — 성공기준: 변경 후 이동 시 모달 뜨고 3버튼 동작. (참조: 화면명세 S0)
- [ ] 전역 에러 처리(에러 대응표대로 인라인/토스트/모달/리다이렉트 + requestId 노출) — 성공기준: 각 code가 표대로 표시됨. (참조: API §0 에러 대응표)

## 6) 프론트 — 화면 (S2~S6)

- [x] S2 운영 체크리스트: 항목 체크, 점수 링 실시간, 담당자명/포지션, **변경감지 저장**, 초기화, PDF — 성공기준: 체크 수만큼 점수 표시·저장/조회·충돌 안내. (참조: 화면명세 S2, SRS §6)
- [x] S3 식자재: 표 입력(단위/옵션 선택, 사용량, 판정 라디오, 원인, 재고, 공급단가), 차이·단가 상태 텍스트·상승집계 실시간, 전회차 단가 즉시 표시, 저장/초기화/PDF — 성공기준: 타이핑 시 상승/하락/동일 텍스트와 상승 N개 색상(1초록/2~3노랑/4↑빨강) 갱신. (참조: 화면명세 S3, SRS §7)
- [x] S4 공산품: 단위 선택, 재고·입고 입력, 여유재고 표시, 저장/초기화/PDF — 성공기준: 저장/조회/충돌 동작. (참조: 화면명세 S4, SRS §8)
- [ ] S5 설정(식자재) 인라인 편집: 카드+리스트, 우상단 `+추가`(맨 아래 스크롤+빈행), 행별 연필/휴지통, 삭제 확인 모달, 드래그 순서변경 — 성공기준: 추가/수정/삭제/순서변경이 즉시 반영되고 catalogVersion 갱신. (참조: 화면명세 S5, SRS §9.1)
- [ ] S6 설정(공산품): S5와 동일 패턴 — 성공기준: 동일. (참조: 화면명세 S6)
- [x] PDF 내보내기(운영/식자재/공산품) — 성공기준: 각 화면에서 현재 데이터로 PDF 생성. (참조: 화면명세 S2~S4)
- [x] 반응형(태블릿/모바일/데스크탑) — 성공기준: 3개 폭에서 레이아웃 정상. (참조: SRS §13, UI/UX §4)

## 7) 기능 검증 (E2E 시나리오)

- [ ] 진입: 1234로 로그인 성공, 오답 시 인라인 에러, 7일 후(또는 토큰 폐기 후) 재로그인 — 성공기준: 시나리오대로 동작. (참조: 화면명세 S1)
- [ ] 운영 저장→타 기기 조회: 광화문/서면 각각 12종 저장 후 다른 기기에서 같은 (지점·영업일)로 조회 시 값 보임. (참조: mvp1 §6)
- [ ] 식자재 전회차 단가: 전날(또는 최근일) 단가가 진입 즉시 채워지고, 공급단가 입력 시 단가 상태 텍스트·상승집계 실시간. (참조: SRS §7.2)
- [ ] 동시 편집(기록): A 저장 후 B가 옛 version으로 저장 시 `VERSION_CONFLICT` 모달→새로고침. (참조: SRS §11)
- [ ] 설정↔체크리스트: 체크리스트 열어둔 채 설정에서 품목 변경 후 체크리스트 저장 시 `CATALOG_CHANGED` 모달(설정 우선). (참조: SRS §11)
- [ ] soft delete + 참조 모델: 품목 이름 변경 시 과거 기록 새 이름 표시; 품목 삭제해도 과거 기록 조회 안 깨짐. (참조: ERD §0)
- [ ] 이탈 가드: 미저장 변경 후 사이드탭 이동 시 모달, [저장 안 함]으로 버려짐 확인. (참조: 화면명세 S0)
- [ ] 빈값 경고: 빈 값 저장 시 1회 경고 후 진행. (참조: SRS §11)
- [ ] PDF: 운영/식자재/공산품 각각 PDF 생성 확인. (참조: 화면명세)
- [ ] 반응형 점검: 모바일/태블릿/데스크탑 수동 확인. (참조: SRS §13)
- [ ] 에러 대응표 점검: 주요 code(VERSION_CONFLICT/CATALOG_CHANGED/INVALID_PASSWORD/VALIDATION_ERROR/DUPLICATE)별 화면 표시가 표와 일치. (참조: API §0)

## 8) 배포 · 운영 (M8)

- [ ] Vercel 배포(web/api) — 성공기준: 프로덕션 URL에서 전 기능 동작. (참조: ADR, mvp1 §M8)
- [ ] Turso 백업 절차 문서화(주 1회 일요일) — 성공기준: 별도 런북에 dump/복구 절차 기재. (참조: SRS §13, ADR 후속)
- [ ] 운영 로그/requestId 확인 경로 정리 — 성공기준: 도메인별 에러 필터가 가능. (참조: API §0)

---

## 진행 메모

- (구현 중 발생하는 결정/이탈 사항을 여기에 누적 기록)
- 2026-06-24: `apps/web` + `apps/api` 모노레포로 전환. API는 Vercel Function 전용이 아닌 Hono 기반 독립 TypeScript 서버로 구현해 로컬/OCI/Docker 배포 가능성을 남김.
- 2026-06-24: Turso/libSQL에 Drizzle migration 적용 및 SRS 기준 지점/식자재/공산품 시드 적재 완료.
- 2026-06-24: 카탈로그 버전은 별도 meta 테이블 없이 마스터 행 `version` 합산으로 계산함.
- 2026-06-24: 설정 화면 순서변경 API는 구현됐고, UI는 현재 인라인 추가/수정/삭제 중심이다. 정교한 드래그앤드랍 UX는 후속 개선 가능.
- 2026-06-24: 사이드탭 active 빨간 선 제거 및 `--surface-3` 배경 적용, 상단 컨텍스트 바 full-bleed 처리, 운영 `managers` JSON 저장, 식자재 카테고리 섹션 행/새 컬럼 순서/단가 텍스트 표시, 공산품 `product_line.unit`·`product_item.spare_stock` 추가 및 설정 편집 반영. API/ERD/SRS/화면명세/UIUX 문서 동기화.
- 2026-06-24: 공산품 체크리스트 `입고(restock_qty)` 인라인 컬럼 추가 및 저장/조회 반영, 식자재 판정 버튼 표시 순서를 `부족/정상/과다`로 조정.
