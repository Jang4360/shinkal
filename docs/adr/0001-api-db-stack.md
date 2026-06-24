# ADR 0001: TypeScript API, Drizzle ORM, Drizzle Kit, Turso/libSQL 채택

## 상태

Accepted

## 날짜

2026-06-23

## 배경

신칼 체크리스트 서비스는 실제 매장에서 운영자가 매일 사용하는 업무 시스템이다. 운영 체크리스트, 식자재 체크리스트, 공산품 체크리스트를 지점별, 날짜별로 저장하고 과거 기록을 조회해야 한다.

예상 사용 조건은 다음과 같다.

| 항목 | 조건 |
|---|---|
| 사용자 수 | 100명 미만 |
| 지점 | 광화문, 서면 |
| 저장 빈도 | 지점별 매일 체크리스트 3종 저장 |
| 데이터 성격 | 텍스트, 숫자 중심의 정형 데이터 |
| 핵심 요구 | 날짜별 이력 조회, 품목 추가/수정/삭제, 동시 저장 충돌 방지 |
| 비용 조건 | 취업 준비 중인 개인 프로젝트이므로 가능한 무료 또는 저비용 운영 필요 |

기존 프로젝트는 React/Vite 기반의 프론트엔드 단일 앱 구조이다. 앞으로는 백엔드 책임을 분리하고, DB 토큰과 저장 로직을 프론트엔드에 노출하지 않는 구조가 필요하다.

## 결정

다음 기술 스택을 사용한다.

| 영역 | 선택 |
|---|---|
| 프론트엔드 | React/Vite |
| 백엔드 | TypeScript API |
| ORM | Drizzle ORM |
| 마이그레이션 | Drizzle Kit |
| 데이터베이스 | Turso/libSQL |
| 배포 | Vercel |

목표 구조는 다음과 같다.

```text
apps/web    React/Vite frontend
apps/api    TypeScript backend
Turso       libSQL database
Vercel      web/api deployment
```

## 선택 이유

### TypeScript API

| 이유 | 설명 |
|---|---|
| 현재 프로젝트와 언어 연속성 | 기존 프론트엔드가 JavaScript/React/Vite 기반이므로 TypeScript 백엔드로 확장하기 쉽다. |
| Turso SDK와 궁합 | Turso/libSQL은 TypeScript/JavaScript SDK 지원이 좋다. |
| 백엔드 분리 | DB 토큰, 권한 검증, 입력 검증, 동시성 제어를 프론트엔드에서 분리할 수 있다. |
| 타입 안정성 | 체크리스트 타입, 지점, 품목, 저장 payload를 타입으로 관리할 수 있다. |
| 배포 단순성 | Vercel 환경에서 API 배포가 쉽고, 추후 별도 서버로 옮길 여지도 있다. |

### Drizzle ORM

| 이유 | 설명 |
|---|---|
| SQL 친화적 | JPA/Hibernate처럼 많은 동작을 숨기기보다 SQL 구조가 코드에 잘 드러난다. |
| 타입 안전성 | TypeScript에서 테이블, 컬럼, 쿼리 결과를 타입으로 다룰 수 있다. |
| Turso/libSQL 지원 | Drizzle은 libSQL/Turso와 잘 맞는 ORM이다. |
| 학습 목적에 적합 | DB 스키마, 제약조건, 트랜잭션, 동시성 설계를 직접 이해하면서 사용할 수 있다. |
| 과도한 추상화 방지 | 작은 운영 시스템에 필요한 만큼만 추상화한다. |

### Drizzle Kit

| 이유 | 설명 |
|---|---|
| 마이그레이션 지원 | 스키마 변경을 SQL migration 파일로 생성하고 적용할 수 있다. |
| 변경 이력 관리 | DB 구조 변경을 Git으로 추적할 수 있다. |
| 운영 안정성 | 임의로 DB를 직접 수정하지 않고, migration 기반으로 변경할 수 있다. |
| 협업 가능성 | 추후 팀원이 생겨도 동일한 DB 변경 절차를 공유할 수 있다. |

### Turso/libSQL

| 이유 | 설명 |
|---|---|
| 무료/저비용 운영 | 취업 준비 중인 개인 프로젝트로서 유료 DB 비용 부담을 줄일 수 있다. |
| 정형 데이터에 적합 | 체크리스트 데이터는 SQL 테이블, 인덱스, 제약조건으로 모델링하기 적합하다. |
| SQLite 호환 | libSQL은 SQLite 호환 RDBMS 계열이므로 SQL, 트랜잭션, unique constraint를 활용할 수 있다. |
| 관리형 DB | OCI VM에 직접 DB를 운영하는 것보다 인프라 관리 부담이 낮다. |
| 충분한 예상 용량 | 현재 요구사항의 일별 저장량은 작고, 장기 누적에도 무료 플랜으로 시작할 여지가 있다. |

## 주요 설계 원칙

| 원칙 | 내용 |
|---|---|
| 프론트엔드 DB 직접 접근 금지 | Turso URL/token은 서버 환경변수로만 관리한다. |
| 지점/날짜/체크리스트 기준 저장 | `branch_id`, `business_date`, `checklist_type` 조합으로 체크리스트 기록을 관리한다. |
| 중복 기록 방지 | `UNIQUE(branch_id, business_date, checklist_type)` 제약을 사용한다. |
| 동시성 충돌 감지 | `version` 컬럼을 사용한 optimistic locking을 적용한다. |
| 과거 기록 보존(참조 모델) | 기록 행은 품목을 `item_id`로 참조만 하고, 품목명·카테고리명은 마스터를 JOIN해 표시한다(이름 변경 시 과거 기록도 함께 반영). 그날 입력/선택한 값(단위·사용량·판정·단가 등)만 기록 행에 저장해 동결한다. 마스터는 하드 삭제하지 않고 `is_active` soft delete만 사용한다. |
| 품목 삭제 정책 | 실제 삭제보다 `is_active` 기반 soft delete를 우선한다. |
| 짧은 트랜잭션 | Turso/libSQL 특성을 고려해 쓰기 트랜잭션은 짧게 유지한다. |
| 백업 필요 | 무료/저비용 DB 사용 리스크를 고려해 별도 백업 절차를 둔다. |

## 대안 검토

| 대안 | 장점 | 제외 또는 보류 이유 |
|---|---|---|
| Supabase Free | PostgreSQL, Auth, 관리 콘솔 제공 | 무료 플랜 용량 및 pause 리스크가 있고, 장기 무료 운영 관점에서 Turso가 더 유리하다. |
| Supabase Pro | 운영 안정성, 백업, 용량 여유 | 월 비용 부담이 있다. |
| OCI VM + PostgreSQL | Spring Boot 백엔드와 가장 정석적인 조합 | 서버, DB, 백업, 보안 업데이트를 직접 운영해야 한다. |
| Spring Boot + Turso | 백엔드 개발자에게 익숙한 구조 | Turso Java/JDBC 생태계가 PostgreSQL/MySQL만큼 자연스럽지 않다. |
| Prisma + Turso | JPA/Hibernate에 가까운 개발 경험 | 추상화가 강하고, DB 설계와 SQL 동작을 직접 이해하려는 목적에는 Drizzle이 더 적합하다. |
| 로컬 SQLite 파일 | 완전 무료, 단순한 구조 | 서버 디스크 의존, 백업/장애 대응 직접 관리, 수평 확장 어려움이 있다. |

## 결과

이 결정으로 백엔드는 프론트엔드와 분리되고, DB 접근은 API 계층으로 제한된다. 데이터 무결성은 Turso/libSQL의 테이블 제약조건과 트랜잭션으로 보장하고, 동시성 충돌은 백엔드의 optimistic locking 로직으로 처리한다.

Drizzle ORM과 Drizzle Kit을 사용해 DB 스키마와 마이그레이션을 코드 저장소에서 관리한다. 이를 통해 실서비스 운영에 필요한 DB 변경 이력, 배포 절차, 동시성 정책을 명확히 유지한다.

## 후속 작업

| 작업 | 설명 |
|---|---|
| 모노레포 구조 전환 | `apps/web`, `apps/api` 구조로 프로젝트를 재구성한다. |
| Turso 프로젝트 생성 | Turso DB를 생성하고 URL/token을 Vercel 환경변수로 등록한다. |
| Drizzle 설정 추가 | `drizzle.config.ts`, schema 파일, migration 폴더를 구성한다. |
| 초기 스키마 설계 | 지점, 사용자, 품목 마스터, 체크리스트 기록, 상세 항목, 감사 로그 테이블을 설계한다. |
| 동시성 저장 API 설계 | version 기반 optimistic locking 저장 API를 구현한다. |
| 백업 절차 정의 | Turso dump 또는 별도 export 기반 백업 절차를 문서화한다. |
