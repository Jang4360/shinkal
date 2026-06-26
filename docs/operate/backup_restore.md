# 백업 / 복구 런북

> 대상: Turso 운영 DB(`shinkal-prod`)의 R2 SQL 덤프 백업과 복구 검증.

## 현재 정책

- 백업 방식: `turso db shell <db> .dump`로 **DB 전체 SQL 덤프** 생성.
- 백업 주기: 2일마다 03:00 KST.
- 저장 위치: Cloudflare R2 비공개 버킷 `shinkal-db-backups`, `turso/*.sql.gz`.
- 알림: GitHub Actions가 백업 성공/실패를 Discord로 직접 전송.

중요: 이 백업은 증분 백업이 아니다. 매 실행마다 그 시점의 전체 DB 내용을 새 `.sql.gz` 파일로 저장한다. 따라서 2일 주기로 실행하면 이틀마다 "전체 스냅샷"이 하나씩 추가된다.

## 일상 점검

1. GitHub Actions `Backup Turso DB`가 2일마다 성공하는지 확인한다.
2. Discord `monitoring` 채널에 성공 메시지가 오는지 확인한다.
3. R2 `shinkal-db-backups/turso/`에 날짜별 `.sql.gz` 파일이 쌓이는지 확인한다.
4. R2 수명 주기 규칙으로 오래된 덤프를 정리한다. 시작값은 90일 보존을 권장한다.

## 복원 리허설

운영 DB를 건드리지 않고 최신 백업을 임시 Turso DB에 복원해 검증한다.

1. GitHub → Actions → `Restore Rehearsal` 선택.
2. `Run workflow` 실행.
3. 워크플로가 최신 R2 덤프를 내려받는다.
4. 임시 DB `shinkal-restore-<run_id>`를 만든다.
5. 덤프를 임시 DB에 복원한다.
6. `sqlite_master` 테이블 수와 `branch` 행 수를 조회해 기본 복원 상태를 확인한다.
7. 임시 DB를 삭제한다.
8. 성공/실패 결과를 Discord에서 확인한다.

이 리허설이 성공해야 "백업 파일이 실제로 복구 가능하다"고 볼 수 있다.

## 실제 장애 복구 절차

1. 장애 시각을 기준으로 사용할 R2 덤프를 고른다.
2. 로컬 또는 GitHub Actions 실행 환경에서 덤프를 내려받는다.

```bash
aws s3 cp s3://shinkal-db-backups/turso/<backup>.sql.gz backup.sql.gz \
  --endpoint-url https://<account_id>.r2.cloudflarestorage.com
gunzip -c backup.sql.gz > backup.sql
```

3. 새 Turso DB를 만든다.

```bash
turso db create shinkal-restore-prod --group default --wait
turso db shell shinkal-restore-prod < backup.sql
```

4. 기본 검증을 수행한다.

```bash
turso db shell shinkal-restore-prod "select count(*) from branch;"
turso db shell shinkal-restore-prod "select count(*) from operation_record;"
turso db shell shinkal-restore-prod "select count(*) from ingredient_record;"
turso db shell shinkal-restore-prod "select count(*) from product_record;"
```

5. 새 DB의 연결 URL과 인증 토큰을 발급한다.
6. Cloudflare Worker의 `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`을 새 DB 값으로 교체한다.
7. 배포 후 `/ready`가 `200`인지 확인한다.
8. 앱에서 로그인, 지점 조회, 최근 영업일 조회, 저장 1회를 확인한다.

## R2 수명 주기 설정

Cloudflare Dashboard → R2 Object Storage → `shinkal-db-backups` → Settings → Object Lifecycle Rules.

권장 시작값:

- Prefix: `turso/`
- Action: expire/delete objects
- Age: 90 days

데이터가 작으면 180일도 가능하지만, 무기한 보관은 피한다.
