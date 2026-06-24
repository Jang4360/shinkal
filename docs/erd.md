# ERD (데이터 모델)

> 상태: 작성 중 (리뷰 대상)
> 대상 서비스: 현풍닭칼국수 매장 운영 체크리스트 (신칼)
> 관련 문서: [체크리스트 관리 SRS](./srs/checklist-management-srs.md), [ADR 0001](./adr/0001-api-db-stack.md), [MVP1 계획](./plans/mvp1.md)

## 0) 공통 규칙

### DB / 타입 규약

DB는 Turso/libSQL(SQLite 호환)이다([ADR 0001](./adr/0001-api-db-stack.md)). 따라서 타입은 SQLite 스토리지 클래스 기준으로 표기한다.

| 표기 | 의미 |
| --- | --- |
| INTEGER | 정수. PK(자동 증가), 외래키, boolean(0/1), 카운트, version에 사용 |
| TEXT | 문자열. 이름/날짜 문자열/그날 선택값에 사용 |
| REAL | 실수. 사용량/단가/재고 등 소수·음수 허용 수치에 사용 |

- **PK**: 모든 테이블의 `*_id`는 `INTEGER PRIMARY KEY AUTOINCREMENT`다.
- **boolean**: 별도 타입이 없어 INTEGER `0`/`1`로 저장한다. (`checked`, `is_active`)
- **영업일(business_date)**: `TEXT`에 `YYYY-MM-DD`(KST 캘린더 날짜)로 저장한다. 새벽 영업 보정은 하지 않는다.
- **시각(created_at/updated_at)**: `TEXT`에 ISO8601(`YYYY-MM-DD HH:MM:SS`, UTC) 형식으로 저장하며 DEFAULT는 `CURRENT_TIMESTAMP`다.
- **수치 컬럼**: SRS §11에 따라 0/소수점/음수/빈 값(NULL)을 모두 허용한다.

### 모델 원칙 (SRS §10)

- **품목은 컬럼이 아니라 행(row)** 으로 모델링한다. `*_record`(기록 1건) ↔ `*_line`/`*_check`(상세 N행) 구조다.
- **참조 모델**: 상세 행(line)은 품목을 `item_id`로 **참조만** 한다. 품목명/카테고리명 같은 **카탈로그(이름) 값은 line에 복사하지 않고 마스터를 JOIN해 표시**한다. 따라서 설정 페이지에서 이름을 바꾸면 **과거 기록 표시도 함께 바뀐다.**
- **line에 저장하는 값 = 그날 사용자가 직접 입력/선택한 사실**(단위, 단위옵션, 기준/실제 사용량, 판정/원인, 재고, 단가)이다. 이 값들은 그날의 기록이므로 마스터 변경의 영향을 받지 않고 **과거 그대로 동결**된다.
- 마스터의 디폴트값(`default_unit`, `default_base_usage` 등)은 **새 입력 폼의 시작값**일 뿐이며, 과거 line 값을 바꾸지 않는다.
- 마스터(품목/카테고리) 삭제는 `is_active = 0` **soft delete**를 기본으로 한다. 참조 모델은 마스터 행이 살아 있어야 JOIN이 되므로 **하드 삭제는 하지 않는다.** (하드 삭제 시 과거 기록의 이름 표시가 깨지고 MVP2 통계 데이터도 유실됨)
- 동일 (지점·영업일·체크리스트)에 대한 중복 기록은 `UNIQUE` 제약으로 막는다.
- 동시 편집 충돌은 `version` 기반 optimistic locking으로 감지한다(SRS §11). 체크리스트 기록(`*_record`)과 마스터(`*_category`/`*_item`) 모두 행마다 `version`을 둔다.
- **설정↔체크리스트 충돌**: 도메인(식자재/공산품)별 **카탈로그 버전**을 두고, 설정에서 품목/카테고리를 추가·삭제·순서변경·수정하면 +1 한다. 체크리스트 저장 시 진입 시점 카탈로그 버전과 달라졌으면(=그 사이 설정이 바뀜) **체크리스트 저장을 거부**하고 새로고침을 안내한다(설정 우선). 저장 방식(메타 행 vs 마스터 `version` 집계)은 API 명세에서 확정.

### 테이블 목록 (총 12개)

| 도메인 | 테이블 |
| --- | --- |
| 공통 | `branch`, `login_attempt` |
| 운영(12종 공유) | `operation_record`, `operation_check` |
| 식자재 | `ingredient_category`, `ingredient_item`, `ingredient_unit_option`, `ingredient_record`, `ingredient_line` |
| 공산품 | `product_item`, `product_record`, `product_line` |

> 운영 12종은 테이블을 12개 만들지 않고 `operation_record.checklist_id`(1~12)로 구분한다. 식자재/공산품은 (record 1건 ↔ line N행) 구조라 품목이 늘고 줄어도 테이블이 변하지 않는다.

---

## 1) branch

### 역할

지점 마스터. 모든 체크리스트 기록이 지점에 연결된다.

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 지점 ID | branch_id | INTEGER | NOT NULL |  |
| 지점명 | name | TEXT | NOT NULL |  |
| 활성 여부 | is_active | INTEGER | NOT NULL | 1 |
| 생성 시각 | created_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |

### 후보값

- `name`: `광화문`, `서면`

### 비고

- 초기 시드로 광화문/서면 2개 행을 적재한다.
- 지점은 현재 추가 빈도가 낮으므로 별도 관리 화면은 두지 않는다(필요 시 시드/마이그레이션으로 추가).
- 지점이 2개로 고정적이라 정렬 컬럼은 두지 않는다(선택 UI는 `광화문`, `서면` 순서로 고정).

---

## 1-1) login_attempt

### 역할

공용 비밀번호 로그인 무차별 대입을 줄이기 위한 시도 횟수 저장 테이블이다. IP 등 클라이언트 키 단위로 실패 횟수와 차단 만료 시각을 저장한다.

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 로그인 키 | login_key | TEXT | NOT NULL |  |
| 실패 횟수 | count | INTEGER | NOT NULL | 0 |
| 윈도우 시작 시각 | first_at | INTEGER | NOT NULL |  |
| 차단 만료 시각 | blocked_until | INTEGER | NOT NULL | 0 |
| 수정 시각 | updated_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |

---

## 2) operation_record

### 역할

운영 체크리스트 **12종 각각의 저장 단위**(지점 + 영업일 + 체크리스트 번호) 1건을 저장한다. 한 번의 저장 버튼 = 이 테이블 1행 + `operation_check` N행.

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 운영 기록 ID | record_id | INTEGER | NOT NULL |  |
| 지점 ID | branch_id | INTEGER | NOT NULL |  |
| 영업일 | business_date | TEXT | NOT NULL |  |
| 체크리스트 번호 | checklist_id | INTEGER | NOT NULL |  |
| 단계 | phase | TEXT | NOT NULL |  |
| 체크리스트명 | checklist_name | TEXT | NOT NULL |  |
| 총점수 | total_score | INTEGER | NOT NULL | 0 |
| 전체 항목 수 | total_items | INTEGER | NOT NULL | 0 |
| 담당자명(호환) | manager_name | TEXT | NULL |  |
| 담당자 포지션(호환) | manager_position | TEXT | NULL |  |
| 담당자 목록 JSON | managers | TEXT | NULL |  |
| 버전 | version | INTEGER | NOT NULL | 1 |
| 생성 시각 | created_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |
| 수정 시각 | updated_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |

### 후보값

- `checklist_id`: `1`~`12` (SRS §6.1 매핑)
- `phase`: `오픈`, `운영`, `마감`

### 비고

- `UNIQUE(branch_id, business_date, checklist_id)`. (지점·영업일·체크리스트당) 1건만 존재하도록 중복 저장을 막는다.
- **저장은 자동 머지/덮어쓰기를 하지 않는다.** 기록이 없으면 INSERT, 있으면 version 확인 후 UPDATE 한다. 불러온 시점 version과 저장 시점 version이 같을 때만 저장하고, 그 사이 다른 사람이 저장해 version이 올라갔으면 **저장을 거부하고 "다른 사람이 먼저 저장했습니다. 새로고침 후 다시 시도하세요"** 안내를 띄운다(SRS §11 optimistic locking). 성공 저장 시 `version`을 +1 한다.
- `total_score`는 **체크된 항목 수(항목당 1점)** 다(SRS §16-2 확정). 가중치·비율이 아니다.
- `total_items`는 저장 시점의 전체 항목 수 스냅샷이며, 화면에 `체크수 / 전체항목수`로 함께 표시할 때 사용한다.
- `managers`는 최대 3칸의 담당자 입력값을 JSON 문자열로 저장한다. 예: `[{"position":null,"name":"홍길동"},{"position":"주방 서브","name":"김"}]`. `manager_name`/`manager_position`은 기존 기록 호환과 대표 담당자 조회용으로 유지한다.
- `phase`, `checklist_name`은 코드 상수(`src/main.jsx`의 `checklistPages`) 기준 스냅샷이다. 운영 항목은 화면 편집 대상이 아니므로 별도 마스터 테이블을 두지 않는다(TBD #1 확정).
- `version`은 optimistic locking용이다. 불러온 version과 저장 시점 version이 같을 때만 저장하고, 다르면 거부한다(SRS §11).
- 조회는 `(branch_id, business_date)` 기준이 잦으므로 해당 인덱스를 둔다.

---

## 3) operation_check

### 역할

운영 기록의 **항목별 체크 여부**를 저장한다. 점검 항목 1개 = 행 1개.

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 운영 항목 ID | check_id | INTEGER | NOT NULL |  |
| 운영 기록 ID | record_id | INTEGER | NOT NULL |  |
| 항목 키 | item_key | TEXT | NOT NULL |  |
| 섹션명 | section_name | TEXT | NULL |  |
| 항목 텍스트 | item_label | TEXT | NOT NULL |  |
| 정렬 순서 | sort_order | INTEGER | NOT NULL | 0 |
| 체크 여부 | checked | INTEGER | NOT NULL | 0 |

### 비고

- `UNIQUE(record_id, item_key)`.
- `item_key`는 코드 상수에서 파생한 안정 키(예: `c{checklist_id}-s{섹션순번}-i{항목순번}`)다.
- `section_name`, `item_label`은 코드 상수 기준 스냅샷이다. 운영 항목 텍스트가 바뀌어도 과거 기록은 저장 당시 텍스트로 보존된다.
- `checked`는 boolean(0/1)이며, `operation_record.total_score`는 동일 record의 `checked = 1` 개수와 일치한다.
- 운영 항목 텍스트가 boolean뿐이라 JSON으로 담는 대안도 있으나, MVP2 점수 추이 집계를 위해 행으로 분리한다.

---

## 4) ingredient_category

### 역할

식자재 카테고리 마스터. 설정 페이지에서 CRUD 한다(SRS §9).

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 카테고리 ID | category_id | INTEGER | NOT NULL |  |
| 카테고리명 | name | TEXT | NOT NULL |  |
| 정렬 순서 | sort_order | INTEGER | NOT NULL | 0 |
| 활성 여부 | is_active | INTEGER | NOT NULL | 1 |
| 버전 | version | INTEGER | NOT NULL | 1 |
| 생성 시각 | created_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |

### 후보값

- 초기 시드 `name`: `닭발주`, `면/곡류`, `채소류`, `양념/조미료류`, `건재/한방재료`, `유제품/기타`, `음료 및 주류` (SRS §7.4)

### 비고

- 삭제는 `is_active = 0` soft delete를 기본으로 한다(하드 삭제 금지 — 참조 모델이라 마스터 행이 살아 있어야 JOIN이 됨).
- 참조 모델이므로 카테고리명을 바꾸면 `ingredient_line`을 JOIN해 표시하는 **과거 기록의 카테고리명도 함께 바뀐다.**
- `version`은 설정↔설정 행 단위 optimistic locking용이다. 추가·삭제·순서변경·수정은 식자재 **카탈로그 버전**도 +1 해 설정↔체크리스트 충돌 감지에 쓴다(SRS §11, §0).

---

## 5) ingredient_item

### 역할

식자재 품목 마스터. 카테고리에 소속되며 설정 페이지에서 CRUD 한다(SRS §9).

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 품목 ID | item_id | INTEGER | NOT NULL |  |
| 카테고리 ID | category_id | INTEGER | NOT NULL |  |
| 품목명 | name | TEXT | NOT NULL |  |
| 기본 단위 | default_unit | TEXT | NULL |  |
| 기본 단위 옵션 | default_unit_option | TEXT | NULL |  |
| 기본 기준 사용량 | default_base_usage | REAL | NULL |  |
| 정렬 순서 | sort_order | INTEGER | NOT NULL | 0 |
| 활성 여부 | is_active | INTEGER | NOT NULL | 1 |
| 버전 | version | INTEGER | NOT NULL | 1 |
| 생성 시각 | created_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |

### 후보값

- `default_unit`: `Kg`, `g`, `단`, `봉`, `개`, `망`, `박스`, `구` (SRS §7.3)
- `default_unit_option`: `Kg` → `1/2.7/3/5/7.5/10/11/13/18/20`, `g` → `250/300/500`, `구` → `15/30` (그 외 단위는 NULL)

### 비고

- `category_id`는 `ingredient_category.category_id`를 참조한다.
- `default_unit`, `default_unit_option`, `default_base_usage`는 입력 편의를 위한 디폴트값이며, 실제 입력 시 사용자가 변경할 수 있다(SRS §7.3, §9).
- `default_unit_option`은 `ingredient_unit_option`(§6) 카탈로그에서 고른 옵션 값을 저장한 값이다(FK가 아니라 선택값 저장 — 옵션이 나중에 삭제돼도 디폴트는 유지).
- 삭제는 `is_active = 0` soft delete를 기본으로 한다. 비활성 품목은 신규 입력 화면에 노출하지 않되 과거 기록은 보존된다.
- 조회 시 `(category_id, sort_order)`로 정렬한다.
- `version`은 설정↔설정 행 단위 optimistic locking용이다. 추가·삭제·순서변경·수정은 식자재 **카탈로그 버전**도 +1 한다(SRS §11).

---

## 6) ingredient_unit_option

### 역할

세부 옵션이 있는 단위(Kg/g/구)의 **선택 옵션 값 카탈로그**다. 설정 페이지(식자재 탭)에서 추가/수정/삭제한다(SRS §9). 체크리스트의 단위 옵션 드롭다운은 이 테이블의 활성 행을 단위별로 읽어 보여준다.

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 옵션 ID | option_id | INTEGER | NOT NULL |  |
| 단위 | unit | TEXT | NOT NULL |  |
| 옵션 값 | value | REAL | NOT NULL |  |
| 정렬 순서 | sort_order | INTEGER | NOT NULL | 0 |
| 활성 여부 | is_active | INTEGER | NOT NULL | 1 |
| 버전 | version | INTEGER | NOT NULL | 1 |
| 생성 시각 | created_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |

### 후보값

- `unit`: `Kg`, `g`, `구` (세부 옵션이 있는 단위)
- 초기 시드 `value`: Kg → `1/2.7/3/5/7.5/10/11/13/18/20`, g → `250/300/500`, 구 → `15/30` (SRS §7.3)

### 비고

- `UNIQUE(unit, value)`. 같은 단위 안에 같은 옵션 값 중복을 막는다.
- `value`는 소수(2.7)를 허용하므로 REAL이다.
- 삭제는 `is_active = 0` soft delete를 기본으로 한다. 추가·수정·삭제·순서변경 시 식자재 **카탈로그 버전**을 +1 한다(SRS §11).
- 단위(Kg/g/단/봉/개/망/박스/구) 자체 목록은 편집 대상이 아니며 코드/시드 고정이다. 본 테이블은 그 단위에 딸린 **옵션 값만** 관리한다.
- 사용자가 고른 옵션 값은 `ingredient_item.default_unit_option`(디폴트)·`ingredient_line.unit_option`(그날 선택값)에 **값으로 저장**된다. 따라서 옵션을 나중에 삭제해도 기존 디폴트/기록은 깨지지 않는다.

---

## 7) ingredient_record

### 역할

식자재 체크리스트의 저장 단위(지점 + 영업일) 1건을 저장한다. 저장 버튼 1회 = 이 테이블 1행 + `ingredient_line` N행.

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 식자재 기록 ID | record_id | INTEGER | NOT NULL |  |
| 지점 ID | branch_id | INTEGER | NOT NULL |  |
| 영업일 | business_date | TEXT | NOT NULL |  |
| 담당자명 | manager_name | TEXT | NULL |  |
| 버전 | version | INTEGER | NOT NULL | 1 |
| 생성 시각 | created_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |
| 수정 시각 | updated_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |

### 비고

- `UNIQUE(branch_id, business_date)`. 식자재는 종류가 1종이므로 `checklist_id`가 없다.
- `manager_name`은 작성 담당자 식별용이다(SRS §5 — 시스템 사용자 추적은 하지 않고 담당자명으로 갈음).
- `version`은 optimistic locking용이다(SRS §11).
- 조회는 `(branch_id, business_date)` 기준이 잦으므로 인덱스를 둔다.

---

## 8) ingredient_line

### 역할

식자재 기록의 **품목별 입력 행**을 저장한다. 품목 1개 = 행 1개.

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 식자재 항목 ID | line_id | INTEGER | NOT NULL |  |
| 식자재 기록 ID | record_id | INTEGER | NOT NULL |  |
| 품목 ID | item_id | INTEGER | NOT NULL |  |
| 단위(그날 선택) | unit | TEXT | NULL |  |
| 단위 옵션(그날 선택) | unit_option | TEXT | NULL |  |
| 기준 사용량 | base_usage | REAL | NULL |  |
| 실제 사용량 | actual_usage | REAL | NULL |  |
| 판정 | verdict | TEXT | NOT NULL | 정상 |
| 원인 | cause | TEXT | NULL |  |
| 재고 | stock | REAL | NULL |  |
| 전회차 단가 | prev_unit_price | REAL | NULL |  |
| 공급단가 | unit_price | REAL | NULL |  |
| 정렬 순서 | sort_order | INTEGER | NOT NULL | 0 |

### 후보값

- `verdict`: `정상`, `과다`, `부족`

### 비고

- `UNIQUE(record_id, item_id)`.
- `item_id`는 `ingredient_item.item_id`를 참조한다(soft delete로 마스터 행은 보존됨).
- **품목명/카테고리명은 line에 저장하지 않는다.** 화면에는 `item_id`로 `ingredient_item` → `ingredient_category`를 JOIN해 현재 이름을 표시한다(참조 모델, §0 참고). 설정에서 이름을 바꾸면 과거 기록 표시도 함께 바뀐다.
- `unit`/`unit_option`은 **그날 사용자가 직접 선택한 값**이다(SRS §7.3 — 매일 직접 선택, 마스터의 `default_unit`은 폼 초기값일 뿐). 따라서 line에 저장하며 과거 기록은 동결된다.
- **차이(실제-기준)** 는 저장하지 않고 `actual_usage - base_usage`로 화면에서 계산한다(SRS §7.2).
- `verdict`(판정)는 `정상`/`과다`/`부족` 중 하나를 라디오 버튼으로 선택한다. NOT NULL(기본 `정상`).
- `cause`(원인)는 판정에 대한 설명을 자유 텍스트로 적는 칸이며 NULL 허용이다(미입력 가능).
- **단가 상태(상승/동일/하락)** 는 저장하지 않고 `unit_price` vs `prev_unit_price` 단순 대소 비교로 화면에서 텍스트로 계산한다(SRS §7.2). 오늘 공급단가를 타이핑하는 순간 실시간으로 갱신된다.
- **단가 상승 집계**(`전회차 대비 N개 상승`, N=1 초록/2~3 노랑/4↑ 빨강)도 저장하지 않고 화면에서 집계한다(SRS §7.2.1).
- `prev_unit_price`(전회차 단가)는 조회 시점에 동적으로 구하지만, 저장 시 그 시점 값을 스냅샷으로 함께 적재해 과거 기록의 단가 상태를 재현 가능하게 한다. 산출 규칙: 해당 품목의 **직전 기록 공급단가**(기본 전날, 없으면 그 이전 가장 최근 기록일)(SRS §2, §7.2).
- 전회차 단가 조회 성능을 위해 `(item_id)` 및 record 조인용 `business_date` 인덱스를 고려한다(SRS §13, 조회 800ms 목표).
- `stock`(재고)은 식자재 현재 보유 재고 입력값이다.

---

## 9) product_item

### 역할

공산품 품목 마스터. 설정 페이지에서 CRUD 한다(SRS §9). 공산품은 카테고리 구분이 없다.

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 품목 ID | item_id | INTEGER | NOT NULL |  |
| 품목명 | name | TEXT | NOT NULL |  |
| 기본 단위 | default_unit | TEXT | NULL |  |
| 여유재고 기준 | spare_stock | REAL | NULL |  |
| 정렬 순서 | sort_order | INTEGER | NOT NULL | 0 |
| 활성 여부 | is_active | INTEGER | NOT NULL | 1 |
| 버전 | version | INTEGER | NOT NULL | 1 |
| 생성 시각 | created_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |

### 후보값

- `default_unit`: `박스`, `봉`, `묶음`, `줄`, `짝`, `개`, `통` (SRS §8.2)
- 초기 시드 품목은 SRS §8.3 참고.

### 비고

- 삭제는 `is_active = 0` soft delete를 기본으로 한다.
- `default_unit`은 공산품 체크리스트 신규 행의 단위 기본값이다. 실제 저장 시 사용자가 선택한 단위는 `product_line.unit`에 동결한다.
- `spare_stock`은 "항상 1박스는 남긴다" 같은 품목별 고정 기준값이며 체크리스트 화면에서는 읽기 전용으로 표시한다.
- `version`은 설정↔설정 행 단위 optimistic locking용이다. 추가·삭제·순서변경·수정은 공산품 **카탈로그 버전**도 +1 해 설정↔체크리스트 충돌 감지에 쓴다(SRS §11, §0).

---

## 10) product_record

### 역할

공산품 체크리스트의 저장 단위(지점 + 영업일) 1건을 저장한다. 저장 버튼 1회 = 이 테이블 1행 + `product_line` N행.

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 공산품 기록 ID | record_id | INTEGER | NOT NULL |  |
| 지점 ID | branch_id | INTEGER | NOT NULL |  |
| 영업일 | business_date | TEXT | NOT NULL |  |
| 담당자명 | manager_name | TEXT | NULL |  |
| 버전 | version | INTEGER | NOT NULL | 1 |
| 생성 시각 | created_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |
| 수정 시각 | updated_at | TEXT | NOT NULL | CURRENT_TIMESTAMP |

### 비고

- `UNIQUE(branch_id, business_date)`. 공산품도 1종이므로 `checklist_id`가 없다.
- `manager_name`은 작성 담당자 식별용이다(SRS §5).
- `version`은 optimistic locking용이다(SRS §11).
- 조회는 `(branch_id, business_date)` 기준이 잦으므로 인덱스를 둔다.

---

## 11) product_line

### 역할

공산품 기록의 **품목별 입력 행**을 저장한다. 품목 1개 = 행 1개.

### 컬럼 명세

| 한글명 | 영어명 | 타입 | NULL | DEFAULT |
| --- | --- | --- | --- | --- |
| 공산품 항목 ID | line_id | INTEGER | NOT NULL |  |
| 공산품 기록 ID | record_id | INTEGER | NOT NULL |  |
| 품목 ID | item_id | INTEGER | NOT NULL |  |
| 단위 | unit | TEXT | NULL |  |
| 재고 | stock | REAL | NULL |  |
| 입고량 | restock_qty | REAL | NULL |  |
| 정렬 순서 | sort_order | INTEGER | NOT NULL | 0 |

### 비고

- `UNIQUE(record_id, item_id)`.
- `item_id`는 `product_item.item_id`를 참조한다.
- `restock_qty`(입고량)는 그날 입고가 있을 때만 입력하는 **그날 입력값**(평소 NULL)이다. MVP2 통계의 공산품 사용량 산출에 쓰인다: **사용량 = 전일 재고 + 당일 입고 − 당일 재고** ([MVP2 §8](./plans/mvp2.md)).
- **품목명은 line에 저장하지 않는다.** 화면에는 `item_id`로 `product_item`을 JOIN해 현재 품목명을 표시한다(참조 모델).
- `unit`은 그날 사용자가 선택한 공산품 단위다. 신규 행은 `product_item.default_unit`으로 시작하지만, 저장 후에는 `product_line.unit`이 과거 기록으로 동결된다.
- `spare_stock`은 품목 마스터 속성이므로 line에 저장하지 않고 `product_item.spare_stock`을 JOIN해 읽기 전용으로 표시한다.
- **1주 평균 사용량**은 입력 컬럼이 아니다. 일자별 `stock` 기록을 바탕으로 **MVP2 통계 페이지**에서 매주 월요일 전주 기준으로 계산해 보여준다(TBD #3 확정, [MVP2 계획](./plans/mvp2.md)).

---

## 12) 관계 다이어그램

### 관계 트리 (텍스트)

```text
branch (지점)
 ├─< operation_record ─< operation_check
 │      (운영 기록 1건)     (항목별 체크 N행)
 │
 ├─< ingredient_record ─< ingredient_line >─ ingredient_item >─ ingredient_category
 │      (식자재 기록 1건)    (품목별 입력 N행)   (품목 마스터)      (카테고리 마스터)
 │
 └─< product_record ─< product_line >─ product_item
        (공산품 기록 1건)   (품목별 입력 N행)  (품목 마스터)

기호:  A ─< B  =  A 1건에 B가 N개 (1:N)
       B >─ C  =  B가 C(마스터)를 참조 (N:1)
```

### 관계 표

| 부모 (1) | 자식 (N) | 외래키 | 의미 |
| --- | --- | --- | --- |
| branch | operation_record | branch_id | 지점별 운영 기록 |
| branch | ingredient_record | branch_id | 지점별 식자재 기록 |
| branch | product_record | branch_id | 지점별 공산품 기록 |
| operation_record | operation_check | record_id | 기록 1건의 항목별 체크 |
| ingredient_record | ingredient_line | record_id | 기록 1건의 품목별 입력 행 |
| ingredient_category | ingredient_item | category_id | 카테고리의 품목들 |
| ingredient_item | ingredient_line | item_id | 품목 마스터 참조(이름은 JOIN으로 표시) |
| product_record | product_line | record_id | 기록 1건의 품목별 입력 행 |
| product_item | product_line | item_id | 품목 마스터 참조(이름·여유재고는 JOIN으로 표시, 단위는 line에 저장) |

> GitHub처럼 Mermaid를 렌더링하는 뷰어에서 다이어그램으로 보고 싶으면 아래 블록을 사용한다. (일부 로컬 마크다운 미리보기는 Mermaid를 렌더링하지 못하고 코드로 표시된다.)
>
> <details><summary>Mermaid 소스 (선택)</summary>
>
> ```mermaid
> erDiagram
>     branch ||--o{ operation_record : has
>     branch ||--o{ ingredient_record : has
>     branch ||--o{ product_record : has
>     operation_record ||--o{ operation_check : contains
>     ingredient_category ||--o{ ingredient_item : groups
>     ingredient_item ||--o{ ingredient_line : referenced_by
>     ingredient_record ||--o{ ingredient_line : contains
>     product_item ||--o{ product_line : referenced_by
>     product_record ||--o{ product_line : contains
> ```
>
> </details>
