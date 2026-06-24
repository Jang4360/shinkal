# API 명세

> 상태: 작성 중 (리뷰 대상)
> 대상 서비스: 현풍닭칼국수 매장 운영 체크리스트 (신칼)
> 관련 문서: [SRS](./srs/checklist-management-srs.md), [ERD](./erd.md), [ADR 0001](./adr/0001-api-db-stack.md), [MVP1 계획](./plans/mvp1.md)

## 0) 공통 규칙

### 기본

| 항목 | 값 |
| --- | --- |
| 프로토콜 | HTTPS |
| 베이스 경로 | `/api` |
| 요청/응답 형식 | JSON (`Content-Type: application/json`) |
| 문자 인코딩 | UTF-8 |
| 날짜 형식 | 영업일은 `YYYY-MM-DD`(KST). 시각은 ISO8601 문자열. |
| 표기 규약 | DB는 snake_case지만 **API의 JSON 필드는 camelCase**를 쓴다. (예: `business_date` → `businessDate`) |
| 수치 | 0/소수/음수/빈 값(`null`) 허용(SRS §11). 빈 값 경고는 프론트에서 처리한다. |

### 인증

- 개별 계정 없이 **공용 비밀번호 1개**로 진입한다(SRS §5).
- `POST /api/auth/login`으로 토큰을 발급받고, 이후 모든 요청에 `Authorization: Bearer <token>` 헤더를 붙인다.
- 토큰 미동봉/만료 시 `401 UNAUTHORIZED`.
- 비밀번호와 토큰 서명 키는 서버 환경변수로만 관리한다(프론트 노출 금지, ADR 0001).

### 공통 응답/에러 형식

성공 응답은 엔드포인트별 데이터 객체를 그대로 반환한다. 에러는 아래 형식으로 통일한다. **운영자가 "어느 비즈니스 영역의 어느 단계에서" 났는지 바로 알 수 있도록 `domain`/`operation`/`requestId`를 항상 포함**한다.

```json
{
  "error": {
    "code": "CATALOG_CHANGED",
    "domain": "INGREDIENT_CHECKLIST",
    "operation": "SAVE",
    "message": "품목 설정이 변경되었습니다. 새로고침 후 다시 시도하세요.",
    "requestId": "req_2026-06-24_3f9a1c",
    "timestamp": "2026-06-24T01:23:45Z",
    "field": null,
    "details": { "expectedCatalogVersion": 18, "sentCatalogVersion": 17 }
  }
}
```

| 필드 | 설명 |
| --- | --- |
| `code` | 에러 종류(아래 코드 카탈로그). 프론트 분기·다국어 키로 사용 |
| `domain` | **에러가 난 비즈니스 영역**(아래 도메인 표). 운영자 트래킹·로그 필터의 1차 기준 |
| `operation` | 영역 안의 단계: `LOGIN`/`LOAD`/`SAVE`/`CREATE`/`UPDATE`/`DELETE`/`REORDER` |
| `message` | 사용자 노출용 한국어 메시지 |
| `requestId` | 요청 추적 ID(로그 상관관계용). 사용자 안내 화면에도 작게 표기 권장 |
| `timestamp` | 서버 발생 시각(UTC ISO8601) |
| `field` | 검증 에러 시 문제 필드명(예: `verdict`). 그 외 `null` |
| `details` | 부가 정보(충돌 버전 값 등). 선택 |

#### 도메인 (`domain`) — 비즈니스 영역 분기

| domain | 영역 | 관련 엔드포인트 |
| --- | --- | --- |
| `AUTH` | 진입 인증 | `POST /auth/login` |
| `BRANCH` | 지점 | `GET /branches` |
| `OPERATION` | 운영 체크리스트 | `GET/PUT /operations`, `GET /operations/templates` |
| `INGREDIENT_CHECKLIST` | 식자재 체크리스트 | `GET/PUT /ingredients` |
| `PRODUCT_CHECKLIST` | 공산품 체크리스트 | `GET/PUT /products` |
| `INGREDIENT_SETTINGS` | 식자재 설정(카테고리/품목/단위옵션) | `/settings/ingredient*` |
| `PRODUCT_SETTINGS` | 공산품 설정(품목) | `/settings/product-items` |

> 서버 로그에는 `[{requestId}] {domain}.{operation} {code} {http}` 형태로 한 줄 남겨, 운영자가 도메인 단위로 필터링/집계할 수 있게 한다.

#### 에러 코드 카탈로그

| HTTP | code | 의미 | 주로 나는 domain/operation |
| --- | --- | --- | --- |
| 400 | `BAD_REQUEST` | 필수 파라미터 누락/형식 오류 | 전 영역 LOAD/SAVE |
| 401 | `UNAUTHORIZED` | 토큰 없음/만료 | 전 영역(보호 API) |
| 401 | `INVALID_PASSWORD` | 진입 비밀번호 불일치 | `AUTH.LOGIN` |
| 404 | `NOT_FOUND` | 대상 리소스 없음(삭제된 품목 등) | SETTINGS UPDATE/DELETE |
| 409 | `VERSION_CONFLICT` | 기록/마스터 행 `version` 불일치(동시 저장) | 체크리스트 SAVE, SETTINGS UPDATE/DELETE |
| 409 | `CATALOG_CHANGED` | 체크리스트 저장 중 품목 설정이 바뀜(설정 우선) | `INGREDIENT_CHECKLIST.SAVE`, `PRODUCT_CHECKLIST.SAVE` |
| 409 | `DUPLICATE` | UNIQUE 위반(같은 단위에 같은 옵션 값 등) | `INGREDIENT_SETTINGS.CREATE/UPDATE` |
| 422 | `VALIDATION_ERROR` | 값 검증 실패. `field`로 위치 표시 | 체크리스트 SAVE, SETTINGS CREATE/UPDATE |
| 500 | `INTERNAL_ERROR` | 서버/DB 오류 | 전 영역 |

#### 프론트 에러 대응표 (화면 표시 방식)

| code | 화면 대응 | 비고 |
| --- | --- | --- |
| `INVALID_PASSWORD` | 로그인 폼 하단 **인라인 에러** 문구, 입력 유지 | "비밀번호가 올바르지 않습니다" |
| `UNAUTHORIZED` | **로그인 화면으로 리다이렉트**(토큰 폐기) | 작업 중이던 입력은 가능하면 보존 |
| `VERSION_CONFLICT` | **모달**: "다른 사람이 먼저 저장했습니다. 새로고침 후 다시 시도하세요" + [새로고침] 버튼 | 새로고침 시 최신 version 재로드 |
| `CATALOG_CHANGED` | **모달**: "품목 설정이 변경되었습니다. 새로고침 후 다시 시도하세요" + [새로고침] | 설정 우선(SRS §11). 재로드 시 catalogVersion 갱신 |
| `DUPLICATE` | 해당 입력 옆 **인라인 에러**(추가/수정 폼) | "이미 있는 값입니다" |
| `VALIDATION_ERROR` | `field` 셀/입력에 **인라인 에러** 표시, 포커스 이동 | 예: 판정 미선택 |
| `NOT_FOUND` | **토스트** + 목록 자동 새로고침 | 이미 삭제된 항목을 수정/삭제 시도 |
| `BAD_REQUEST` | **토스트**(일반 오류) + `requestId` 작게 표기 | 보통 버그. 로그 확인용 |
| `INTERNAL_ERROR` | **토스트/오류 카드**: "일시적 오류입니다. 잠시 후 다시 시도하세요" + `requestId` | 운영자 문의 시 requestId 전달 |

> 표시 우선순위: 인라인(필드 단위 문제) < 토스트(일시/단발) < 모달(사용자 결정 필요: 새로고침 등) < 리다이렉트(세션). 모든 화면 오류 카드/모달에는 `requestId`를 작게 노출해 운영자 추적을 돕는다.

### 동시성 계약 (요약)

| 대상 | 보호 키 | 충돌 시 |
| --- | --- | --- |
| 체크리스트 저장(운영/식자재/공산품) | 기록 `version` | `409 VERSION_CONFLICT` |
| 식자재/공산품 체크리스트 저장 | 도메인 `catalogVersion` | `409 CATALOG_CHANGED` (설정 편집 우선) |
| 설정(마스터) 저장 | 마스터 행 `version` | `409 VERSION_CONFLICT` |

- 저장은 자동 머지/덮어쓰기를 하지 않는다. 불러온 `version`이 최신일 때만 저장하고 성공 시 +1 한다.
- `catalogVersion`은 식자재/공산품 각 도메인의 카탈로그 변경 카운터다. GET 시 함께 내려주고, 체크리스트 저장 시 클라이언트가 되돌려 보낸다. 서버가 보관하는 현재 값과 다르면 `CATALOG_CHANGED`로 거부한다. (저장 방식 = 전용 메타 행 또는 마스터 `version` 집계, 구현에서 확정)

---

## 1) 인증

### POST /api/auth/login

공용 비밀번호로 진입 토큰을 발급한다.

**요청**

```json
{ "password": "회사 공용 비밀번호" }
```

**응답 200**

```json
{ "token": "<token>", "expiresAt": "2026-07-01T00:00:00Z" }
```

**에러**: `401 INVALID_PASSWORD`(비밀번호 불일치)

**정책**

- 비밀번호는 서버 환경변수 `APP_PASSWORD`로 관리한다(코드 하드코딩·DB 저장 안 함). 토큰 서명 키는 `AUTH_TOKEN_SECRET`.
- **단일 토큰만 발급한다(refresh 토큰 없음). 만료는 7일.** 만료되면 재로그인한다.
- 저장은 XSS 안전을 위해 **httpOnly 쿠키** 권장(`token`을 쿠키로 내려도 됨). localStorage는 비권장.
- **로그아웃 엔드포인트는 없다.** stateless 토큰이라 클라이언트가 토큰(쿠키)을 폐기하고 S1로 이동한다.

---

## 2) 지점

### GET /api/branches

지점 목록을 반환한다.

**응답 200**

```json
{ "branches": [ { "branchId": 1, "name": "광화문" }, { "branchId": 2, "name": "서면" } ] }
```

---

## 3) 운영 체크리스트

### GET /api/operations/templates

운영 12종의 정의(단계/섹션/항목)를 반환한다. 항목은 코드 상수 기준이며 편집 대상이 아니다(SRS §6, TBD#1).

**응답 200**

```json
{
  "templates": [
    {
      "id": 1,
      "phase": "오픈",
      "title": "매장 오픈 [홀]",
      "roles": ["홀 메인", "홀 서브", "홀 서서브"],
      "sections": [
        { "title": "외부/전원", "items": ["에어컨팬, 배너 및 외부 청결 상태 확인"] }
      ]
    }
  ]
}
```

### GET /api/operations

특정 (지점·영업일·체크리스트) 기록을 조회한다. 없으면 `exists:false`로 빈 상태를 반환한다.

**쿼리 파라미터**: `branchId`(필수), `businessDate`(필수), `checklistId`(필수, 1~12)

**응답 200**

```json
{
  "exists": true,
  "version": 3,
  "managers": [
    { "position": null, "name": "홍길동" },
    { "position": "홀 메인", "name": "김철수" }
  ],
  "managerName": "홍길동",
  "managerPosition": "홀 메인",
  "totalScore": 18,
  "totalItems": 22,
  "checks": [ { "itemKey": "c1-s0-i0", "checked": true } ]
}
```

> 기록이 없으면 `exists:false`, `version:0`, `checks:[]`을 반환하고 프론트는 템플릿으로 빈 화면을 그린다.

### PUT /api/operations

운영 체크리스트를 저장(신규/수정)한다. 기록이 없으면 INSERT, 있으면 `version` 확인 후 UPDATE.

**요청**

```json
{
  "branchId": 1,
  "businessDate": "2026-06-23",
  "checklistId": 1,
  "managers": [
    { "position": null, "name": "홍길동" },
    { "position": "홀 메인", "name": "김철수" }
  ],
  "managerName": "홍길동",
  "managerPosition": "홀 메인",
  "checks": [ { "itemKey": "c1-s0-i0", "checked": true } ],
  "version": 3
}
```

- `totalScore`(체크된 항목 수, 1점/항목)와 `totalItems`는 **서버가 계산**한다(SRS §6.2).
- `managers`는 화면의 담당자 입력칸을 그대로 저장하는 최대 3개 배열이다. `managerName`/`managerPosition`은 기존 호환용 대표값으로 함께 허용한다.
- 신규 저장 시 `version`은 `0`으로 보낸다.

**응답 200**

```json
{ "version": 4, "totalScore": 19, "totalItems": 22 }
```

**에러**: `409 VERSION_CONFLICT`(그 사이 다른 사람이 저장)

---

## 4) 식자재 체크리스트

### GET /api/ingredients

특정 (지점·영업일)의 식자재 체크리스트를 조회한다. **활성 품목 전체**를 행으로 반환하며, 저장된 기록이 있으면 입력값을 병합하고, 각 품목의 **전회차 단가를 즉시 채워** 보낸다(SRS §7.2, MVP1 M4).

**쿼리 파라미터**: `branchId`(필수), `businessDate`(필수)

**응답 200**

```json
{
  "exists": true,
  "version": 2,
  "catalogVersion": 17,
  "managerName": "김철수",
  "lines": [
    {
      "itemId": 12,
      "categoryName": "채소류",
      "itemName": "배추",
      "unit": "Kg",
      "unitOption": 5,
      "baseUsage": 10,
      "actualUsage": 12,
      "verdict": "과다",
      "cause": "행사 물량",
      "stock": 3,
      "prevUnitPrice": 3000,
      "unitPrice": 3100
    }
  ]
}
```

- `categoryName`/`itemName`은 마스터 JOIN 결과다(참조 모델, ERD §0). 설정에서 이름이 바뀌면 과거 조회도 새 이름으로 보인다.
- `prevUnitPrice`는 해당 품목의 **직전 기록 공급단가**(기본 전날, 없으면 그 이전 최근일)다(SRS §2). 신규/기존 무관하게 항상 채워 보낸다.
- 신규(기록 없음)면 `exists:false`, `version:0`, 각 행은 마스터 디폴트(`unit`/`unitOption`/`baseUsage`)로 프리필되고 입력값은 비어 있다.

### PUT /api/ingredients

식자재 체크리스트를 저장한다. 기록 `version`과 `catalogVersion`을 함께 검증한다.

**요청**

```json
{
  "branchId": 1,
  "businessDate": "2026-06-23",
  "managerName": "김철수",
  "version": 2,
  "catalogVersion": 17,
  "lines": [
    {
      "itemId": 12,
      "unit": "Kg",
      "unitOption": 5,
      "baseUsage": 10,
      "actualUsage": 12,
      "verdict": "과다",
      "cause": "행사 물량",
      "stock": 3,
      "unitPrice": 3100
    }
  ]
}
```

- `unit`/`unitOption`/사용량/판정/원인/재고/단가는 **그날 입력값**으로 line에 저장한다(입력값 동결, ERD §0).
- `prevUnitPrice`는 **서버가 저장 시점에 스냅샷**으로 적재한다(클라이언트가 보내지 않음).
- 차이(실제-기준)·단가 상태 텍스트·상승 집계는 저장하지 않는다(화면 계산, SRS §7.2).

**응답 200**

```json
{ "version": 3, "catalogVersion": 17 }
```

**에러**: `409 VERSION_CONFLICT`(기록 충돌) · `409 CATALOG_CHANGED`(그 사이 품목 설정 변경 → 설정 우선) · `422 VALIDATION_ERROR`(`verdict` 후보값 밖)

---

## 5) 공산품 체크리스트

### GET /api/products

특정 (지점·영업일)의 공산품 체크리스트를 조회한다. 활성 품목 전체를 행으로 반환한다.

**쿼리 파라미터**: `branchId`(필수), `businessDate`(필수)

**응답 200**

```json
{
  "exists": false,
  "version": 0,
  "catalogVersion": 9,
  "managerName": null,
  "lines": [
    { "itemId": 3, "itemName": "195파이(소)", "unit": "박스", "stock": null, "restockQty": null, "spareStock": 1 }
  ]
}
```

- `itemName`/`spareStock`은 마스터 JOIN 결과다(참조 모델). `unit`은 저장된 line 값이 있으면 그 값을, 없으면 `product_item.default_unit`을 반환한다.
- `spareStock`은 품목별 고정 기준값이며 체크리스트에서는 읽기 전용이다.
- `restockQty`(입고량)는 그날 입고가 있을 때만 입력하는 그날 값(평소 null). MVP2 통계의 공산품 사용량 산출에 쓰인다.
- 1주 평균 사용량은 입력 컬럼이 아니다(MVP2 통계).

### PUT /api/products

공산품 체크리스트를 저장한다.

**요청**

```json
{
  "branchId": 1,
  "businessDate": "2026-06-23",
  "managerName": "박영희",
  "version": 0,
  "catalogVersion": 9,
  "lines": [ { "itemId": 3, "unit": "박스", "stock": 5, "restockQty": 2 } ]
}
```

- `unit`은 그날 선택한 공산품 단위로 `product_line.unit`에 저장한다. 허용값은 `박스/봉/묶음/줄/짝/개/통`.
- `restockQty`(입고량)는 `product_line.restock_qty`에 저장한다. 입고가 없는 날은 생략/`null`.

**응답 200**

```json
{ "version": 1, "catalogVersion": 9 }
```

**에러**: `409 VERSION_CONFLICT` · `409 CATALOG_CHANGED`

---

## 6) 설정 — 식자재 (식자재 탭)

> 모든 식자재 설정 변경(추가/수정/삭제/순서변경)은 **식자재 `catalogVersion`을 +1** 한다. 응답에 갱신된 `catalogVersion`을 포함한다. 마스터 행 수정은 행 `version`으로 충돌을 검사한다(SRS §9, §11).

### GET /api/settings/ingredients

설정 화면용 식자재 마스터 전체(카테고리/품목/단위옵션)와 현재 카탈로그 버전을 반환한다.

**응답 200**

```json
{
  "catalogVersion": 17,
  "categories": [ { "categoryId": 1, "name": "채소류", "sortOrder": 0, "version": 2 } ],
  "items": [
    { "itemId": 12, "categoryId": 1, "name": "배추", "defaultUnit": "Kg",
      "defaultUnitOption": 5, "defaultBaseUsage": 10, "sortOrder": 0, "version": 4 }
  ],
  "unitOptions": [ { "optionId": 1, "unit": "Kg", "value": 5, "sortOrder": 3, "version": 1 } ]
}
```

> 기본은 활성(`is_active=1`) 행만 반환한다.

### 카테고리

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| POST | `/api/settings/ingredient-categories` | 추가 `{ name }` |
| PATCH | `/api/settings/ingredient-categories/{categoryId}` | 수정 `{ name, version }` |
| DELETE | `/api/settings/ingredient-categories/{categoryId}` | soft delete `{ version }` |
| PATCH | `/api/settings/ingredient-categories/reorder` | 순서변경 `{ orderedIds: [3,1,2] }` |

### 품목

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| POST | `/api/settings/ingredient-items` | 추가 `{ categoryId, name, defaultUnit?, defaultUnitOption?, defaultBaseUsage? }` |
| PATCH | `/api/settings/ingredient-items/{itemId}` | 수정 `{ categoryId?, name?, defaultUnit?, defaultUnitOption?, defaultBaseUsage?, version }` |
| DELETE | `/api/settings/ingredient-items/{itemId}` | soft delete `{ version }` |
| PATCH | `/api/settings/ingredient-items/reorder` | 순서변경 `{ categoryId, orderedIds: [...] }` |

### 단위 옵션

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| POST | `/api/settings/ingredient-unit-options` | 추가 `{ unit, value }` |
| PATCH | `/api/settings/ingredient-unit-options/{optionId}` | 수정 `{ value, version }` |
| DELETE | `/api/settings/ingredient-unit-options/{optionId}` | soft delete `{ version }` |
| PATCH | `/api/settings/ingredient-unit-options/reorder` | 순서변경 `{ unit, orderedIds: [...] }` |

**공통 응답 200** (예: 추가)

```json
{ "catalogVersion": 18, "categoryId": 8, "version": 1 }
```

**에러**: `409 VERSION_CONFLICT`(행 충돌) · `409 DUPLICATE`(`UNIQUE(unit, value)` 위반) · `400 BAD_REQUEST`

---

## 7) 설정 — 공산품 (공산품 탭)

> 모든 공산품 설정 변경은 **공산품 `catalogVersion`을 +1** 한다.

### GET /api/settings/products

```json
{
  "catalogVersion": 9,
  "items": [ { "itemId": 3, "name": "195파이(소)", "defaultUnit": "박스", "spareStock": 1, "sortOrder": 0, "version": 1 } ]
}
```

### 품목

| 메서드 | 경로 | 동작 |
| --- | --- | --- |
| POST | `/api/settings/product-items` | 추가 `{ name, defaultUnit?, spareStock? }` |
| PATCH | `/api/settings/product-items/{itemId}` | 수정 `{ name?, defaultUnit?, spareStock?, version }` |
| DELETE | `/api/settings/product-items/{itemId}` | soft delete `{ version }` |
| PATCH | `/api/settings/product-items/reorder` | 순서변경 `{ orderedIds: [...] }` |

**에러**: `409 VERSION_CONFLICT` · `400 BAD_REQUEST`

---

## 8) 엔드포인트 요약

| 그룹 | 메서드/경로 |
| --- | --- |
| 인증 | `POST /api/auth/login` |
| 지점 | `GET /api/branches` |
| 운영 | `GET /api/operations/templates` · `GET /api/operations` · `PUT /api/operations` |
| 식자재 | `GET /api/ingredients` · `PUT /api/ingredients` |
| 공산품 | `GET /api/products` · `PUT /api/products` |
| 설정(식자재) | `GET /api/settings/ingredients` · `*/ingredient-categories` · `*/ingredient-items` · `*/ingredient-unit-options` (POST/PATCH/DELETE/reorder) |
| 설정(공산품) | `GET /api/settings/products` · `*/product-items` (POST/PATCH/DELETE/reorder) |
| 통계 | `GET /api/stats/ingredients` · `GET /api/stats/products` · `GET /api/stats/operations` |

## 9) 통계 API (MVP2)

공통 쿼리: `branchId`, `month=YYYY-MM`. 모든 통계 API는 인증 쿠키가 필요하며, 데이터가 없는 달은 200과 빈 배열/0 값을 반환한다.

| API | 반환 요약 |
|---|---|
| `GET /api/stats/ingredients` | 최근 12개월 품목별 월평균 단가 추이(최고/최저 포함), 선택 월 전월 대비 단가 상승 Top5, 선택 월 실제 사용량 합계와 차이 누계 |
| `GET /api/stats/products` | 선택 월 주차별 품목 1주 평균 사용량. 일별 사용량 공식은 `전일재고 + 당일입고 - 당일재고`, 음수는 0, 전일 기록이 없으면 제외 |
| `GET /api/stats/operations` | 선택 월 미체크 항목 Top5, 체크리스트별 월 평균 `total_score` |

## 10) 범위 밖 (MVP2 이후)

- 통계 내보내기(PDF/CSV), 지점 비교, 공산품 사용량 장기 추이, 운영 총점수 월별 추이
- 개별 계정/권한, 감사 로그, 오프라인 동기화, 외부 시스템 연동
