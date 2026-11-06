# Todo 10 감사 로그 테이블 삭제 검증 (2단계)

1단계 #1758은 main `f8dfbbed5`로 머지되어 v0.24.59로 운영에 나갔다. 운영 원장 head는 `20261105220100_copy_audit_log_to_domain_history`다.
이 브랜치는 그 main과 Todo 6 2단계 #1756(`cb19f9a3a`)을 합친 위에 있고, #1756과 같은 다음 릴리스로 나간다.
`migrate deploy`는 #1756의 `20261105225000_retire_file_tables`를 먼저, 이 PR의 `20261106000000_retire_audit_log`를 나중에 적용한다.

## 2단계가 바꾸는 것

- `20261106000000_retire_audit_log`는 `AuditLog`를 잠그고 남은 행 전부의 경로를 1단계와 같은 규칙으로 다시 정한다. 1단계 마이그레이션 뒤 이미지 교체 전까지 옛 이미지가 쓴 행도 여기서 팀·프로그램 이력으로 복사한다. 같은 `("sourceTable", "sourceId")` 키가 이미 있으면 건너뛴다.
- 경로 없는 행, 이관되지 않은 신청 행, 가져오지 않은 사용자 행, 객체가 아닌 메타데이터가 하나라도 있으면 지우기 전에 중단한다. 복사 뒤 팀·프로그램 복사본이 키로 모두 있는지와 경로를 받은 행 수가 원본 행 수와 같은지 대조하고, 다르면 중단한다. 어느 쪽이든 트랜잭션 전체가 되돌아가 지운 행은 0이다.
- 대조가 맞으면 `DROP TABLE "AuditLog"`로 행, 테이블, append-only 트리거를 함께 지운다. `reject_audit_log_mutation()` 함수는 `UserHistory`·`AdminHistory`의 append-only 트리거가 쓰므로 남긴다.
- `schema.prisma`에서 `AuditLog` 모델과 `User.auditLogs` 관계를 지운다. 사용자 통합 리플레이 스펙이 옛 스키마에 붙이는 fixture에서도 같은 관계 한 줄을 지웠다.
- 사용자 도메인 서비스가 주입받던 `auditLog` 의존성 이름을 `userHistory`로 맞춘다. 쓰는 테이블은 1단계부터 `UserHistory`이고 바뀌지 않는다.
- 이력 쓰기가 아직 쓰는 메타데이터 생성기와 설정은 `platform/history-metadata.service.ts`, `platform/history-metadata.config.ts`로, AUD 오류 코드와 `InvalidAuditLogMetadataError`는 `platform/history.error.ts`로 옮겼다. 메서드 이름과 저장 모양은 그대로다. 생성기를 사용자·프로그램·GitHub 도메인이 함께 쓰므로 도메인별로 나누지 않고 공용 platform 파일로 이름만 바꿨다.
- 옛 `AuditLog` 행만 읽던 메타데이터 parser와 그 전용 spec, 지운 테이블의 트리거를 검사하던 `audit-log-append-only.integration.spec.ts`를 지웠다.
- 손으로 돌리는 리허설용 `deploy/jenkins/program-migration/audit-log/retire.json`, `check-retired.sql`, `count-ProgramHistory.sql`을 더했다.

`platform/audit-log*` 제품 파일은 읽기 repository와 읽기 service 두 개, 479줄이다. 남은 `audit-log-history.fixture.ts`와 `audit-log-mapping.fixture.ts`는 읽기 spec의 fixture라 원장의 제품 파일 규칙에서 빠진다.
파일별 상태는 [파일 원장](file-ledger.md)의 「Todo 10 2단계」 절에 있다.

## 마이그레이션

| 마이그레이션 | sha256 |
| --- | --- |
| `20261106000000_retire_audit_log` | `0ba5618d33255b3de898019fd11a487227bf16de92377908dbd79732d7e595ae` |

1단계 두 마이그레이션은 바꾸지 않았다. 최종 head에서 다시 잰 해시가 [1단계 문서](task-10-program-table-simplification.md)와 같다.
같은 릴리스에서 먼저 적용되는 #1756의 `20261105225000_retire_file_tables`는 sha256 `837652646e270fa619ef8c4cf27e84093b06313e305e58014868082f4a3423aa`이다.

`audit-log/retire.json`의 `expectedHeadMigration`은 `20261105225000_retire_file_tables`다. 이 PR이 #1756 위에 쌓여 같은 `migrate deploy`에서 그 뒤에 적용되기 때문이다.
`rehearse.sh`는 단계 SQL을 복원한 덤프에 직접 적용하고 `_prisma_migrations`에 쓰지 않는다. 그래서 이 매니페스트는 #1756의 마이그레이션까지 적용한 덤프에서 돌린다.
`check-retired.sql`은 `AuditLog`가 있거나 `reject_audit_log_mutation()`이 정확히 하나가 아니면 0이 아닌 수를 낸다.

## 리허설

최종 head `1bcd3c020`의 `apps/backend/prisma`와 `deploy/jenkins`로 운영 복제본에서 한 번 돌렸다.
운영 호스트에서 `default_transaction_read_only=on`으로 `pg_dump --no-owner --no-acl`을 떴다. 덤프는 3,706,422바이트, 권한 600이고, 권한 700 임시 디렉터리에만 두었다가 끝난 뒤 지웠다.
복제본은 운영과 같은 digest의 `postgres:17-alpine`이고 `--network none`, 메모리 512MiB, CPU 0.5, 포트 0, 리허설 라벨, tmpfs 데이터 디렉터리다.
`prisma` CLI는 운영 이미지 `oss-hub-backend:v0.24.59`의 것을 쓰고, 복제본만 닿는 네트워크에서 이 head의 `prisma` 디렉터리를 읽기 전용으로 붙였다. 운영 env 파일, compose 프로젝트, 비밀값은 쓰지 않았다.

| 경로 | 결과 |
| --- | --- |
| 복제 직후 | head `20261105220100_copy_audit_log_to_domain_history`, 미완료 0, Jenkins 원장 가드 `ordinary`, `audit-log/check-before.sql` 0, `audit-log/check-copy.sql` 0, `files/check-before-retire.sql` 0 |
| 한 번의 `migrate deploy` | exit 0, 적용 순서가 정확히 `20261105225000_retire_file_tables`, `20261106000000_retire_audit_log`, head `20261106000000_retire_audit_log`, 미완료 0 |
| 적용 뒤 읽기 전용 대조 | `audit-log/check-retired.sql` 0, `files/check-retired.sql` 0, `AuditLog` 없음, `reject_audit_log_mutation()` 1개, `admin_history_append_only`·`user_history_append_only` 트리거 유지, 원장 가드 `ordinary` |
| 적용 뒤 Prisma | `migrate status` up to date, 두 번째 `migrate deploy`는 No pending migrations, 적용 중 Postgres 오류 0 |
| 적용 뒤 스키마 차이 | `migrate diff` exit 2. 남은 차이는 연간 집계 테이블 두 개, `Program_createdById_*` 인덱스 두 개, `GithubRepository_teamId_key`, `MilestoneDocumentSubmissionHistory` 인덱스 이름이고 R2 배포 뒤에도 있던 것이다. `AuditLog`와 #1756이 지우는 파일 테이블은 없다 |
| `audit-log/retire.json` 정상 | #1756 마이그레이션만 적용한 복제본 덤프에서 exit 0, `PREFLIGHT_OK head=20261105225000_retire_file_tables`, `BACKUP_VERIFIED`, `RECONCILE_OK`, `REHEARSAL_OK name=audit-log-retire stages=1 counts=5`, 백업 복원 건수 다섯 개 일치(AuditLog 371, TeamHistory 170, ProgramHistory 24, Program 10, Team 33) |
| 복사본 없는 신청 행 1건, 실제 `migrate deploy` | exit 1, 로그 원인 `AuditLog retire blocked: unrouted=0 application_not_copied=1 user_not_imported=0 metadata_not_object=0`, 원장 행 미완료, 적용 전후 건수 같음(AuditLog 372, 지운 행 0) |
| 정리 | 리허설 컨테이너 0, 볼륨 증감 0, 덤프 파일 0, 임시 디렉터리 삭제 |

## 운영 데이터

위 리허설의 운영 덤프(2026-11-05 21:55Z 무렵)에서 건수만 읽었다.
`AuditLog`는 371행이고 1단계 문서의 운영 읽기와 경로별 건수까지 같다. 경로 없는 행과 중단 경로는 0이다.
1단계 복사 뒤 옛 이미지가 새로 쓴 행은 없어, 2단계가 새로 복사하는 행은 0이다. 적용 전후 `TeamHistory` 170, `ProgramHistory` 24, `UserHistory` 296, `AdminHistory` 12가 그대로다.

| 경로 | 행 | 2단계 처리 |
| --- | --- | --- |
| `ALREADY_IN_TEAM_HISTORY` | 73 | #1752가 옮긴 신청 행, 복사본 확인 뒤 삭제 |
| `IMPORTED_USER_DOMAIN` | 123 | 사용자 도메인이 가져간 행, 복사본 확인 뒤 삭제 |
| `MIGRATE_TEAM` | 63 | 1단계 `TeamHistory` 복사본 확인 뒤 삭제 |
| `MIGRATE_TEAM_DELETED_EVENT` | 1 | 1단계 `TeamHistory` `DELETED` 복사본 확인 뒤 삭제 |
| `MIGRATE_PROGRAM` | 7 | 1단계 `ProgramHistory` 복사본 확인 뒤 삭제 |
| `MIGRATE_PROGRAM_DELETED_EVENT` | 17 | 1단계 `ProgramHistory` `DELETED` 복사본 확인 뒤 삭제 |
| `MIGRATE_REPOSITORY` | 1 | 1단계 `TeamHistory` `REPOSITORY_PUBLISHED` 복사본 확인 뒤 삭제 |
| `DELETE_NO_TARGET` | 80 | 대상이 사라져 복사하지 않고 삭제 |
| `DELETE_COLLECTION_SYNC` | 5 | 수집 실행 행, 둘 곳이 없어 복사하지 않고 삭제 |
| `DELETE_REPO_GONE` | 1 | 저장소가 사라져 복사하지 않고 삭제 |

이 작업은 운영에 쓰지 않았다. 배포 직전 읽기 전용 건수, 백업 검증, 대조 0, 실제 삭제 건수, 배포 뒤 테이블 부재와 감사 화면 확인은 릴리스 레인이 기록한다.

## 최종 head 검증

대상 코드 head는 `1bcd3c020`이다. main `f8dfbbed5`와 #1756 `cb19f9a3a`를 포함한다. 이 뒤의 커밋은 이 문서만 더한다.

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter backend exec prisma generate` | exit 0 |
| `pnpm --filter backend typecheck` | exit 0 |
| `pnpm --filter frontend typecheck` | exit 0 |
| `pnpm --filter backend test:integration` | exit 0 · Test Suites: 158 passed, 158 total / Tests: 1285 passed, 1285 total |
| `bun scripts/check-file-ledger.ts` | exit 0 · FILE_LEDGER_OK 275 paths |
| 운영 복제본 리허설 | 위 리허설 표 |

통합 실행 안에서 계획의 두 jest 스펙 `src/platform/audit-history-read.integration.spec.ts`와 `prisma/audit-log-removal-migration.integration.spec.ts`, #1756의 `prisma/file-retirement-migration.integration.spec.ts`, 사용자 통합 리플레이 스펙들이 통과했다.

`.github/workflows/ci.yml` 잡의 로컬 재현은 그 전 head `5616da65f`에서 한 번 돌렸다. 그 뒤 바뀐 것은 사용자 통합 fixture 한 줄 `db52caf7f`, main `f8dfbbed5` 병합, 매니페스트 head 한 줄, #1756 병합이고, 최종 head에서는 위 표만 다시 돌렸다. `<base>`는 `97114d519`다.

<details><summary><code>5616da65f</code>의 CI 재현</summary>

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter backend exec prisma generate` | exit 0 |
| `node --test deploy/frontend/select-release-deploy-scope.test.mjs` | exit 0 · ℹ pass 32 / ℹ fail 0 |
| `bash -n (dev.sh, deploy, prisma, test, .github의 sh 전부)` | exit 0 |
| `bash apps/backend/prisma/check-host-db-url.test.sh` | exit 0 |
| `bash .githooks/pre-commit.test.sh` | exit 0 |
| `node --check (deploy, .design-sync의 mjs 전부)` | exit 0 |
| `docker compose -f compose.yml config --no-interpolate --quiet` | exit 0 |
| `node --test deploy/jenkins/release-behavior.test.mjs` | exit 0 · ℹ pass 92 / ℹ fail 0 |
| `node --test deploy/jenkins/user-consolidation*.test.mjs` | exit 0 · ℹ pass 90 / ℹ fail 0 |
| `node --test deploy/jenkins/program-migration/*.test.mjs` | exit 0 · ℹ pass 46 / ℹ fail 0 |
| `shellcheck (koalaman/shellcheck 고정 이미지)` | exit 0 |
| `node --test deploy/jenkins/validate-production-env.test.mjs` | exit 0 · ℹ pass 78 / ℹ fail 0 |
| `node --test deploy/jenkins/validate-github-app-credentials.test.mjs` | exit 0 · ℹ pass 4 / ℹ fail 0 |
| `workflow에 옛 Jenkins 참조 없음 grep` | exit 0 |
| `bash deploy/jenkins/prune-deploy-backups.test.sh` | exit 0 |
| `pnpm lint:structure` | exit 0 |
| `pnpm format:check` | exit 0 |
| `node --test .design-sync/contract.test.mjs` | exit 0 · ℹ pass 7 / ℹ fail 0 |
| `pnpm --filter frontend lint` | exit 0 |
| `pnpm --filter frontend typecheck` | exit 0 |
| `pnpm --filter frontend test --maxWorkers=2` | exit 0 · Test Files 440 passed (440) / Tests 4754 passed (4754) |
| `pnpm --filter frontend build` | exit 0 |
| `pnpm --filter backend lint` | exit 0 |
| `pnpm --filter backend typecheck` | exit 0 |
| `pnpm --filter backend test:unit` | exit 0 · Test Suites: 379 passed, 379 total / Tests: 6028 passed, 6028 total |
| `bash apps/backend/test/run-integration.test.sh` | exit 0 · Test Suites: 1 passed, 1 total / Tests: 1 passed, 1 total |
| `pnpm --filter backend build` | exit 0 |
| `pnpm --filter backend test:storage-reconcile` | exit 0 · 단위 Test Suites: 6 passed, 6 total / Tests: 141 passed, 141 total · 통합 Test Suites: 1 passed, 1 total / Tests: 5 passed, 5 total |
| `bun scripts/check-file-ledger.ts` | exit 0 · FILE_LEDGER_OK 275 paths |
| `pnpm exec commitlint --from <base> --to HEAD` | exit 0 |
| `bash .github/check-public-safe.test.sh` | exit 0 |
| `gitleaks git --log-opts=<base>..HEAD` | exit 0 · no leaks found |
| `bash .github/check-public-safe.sh <base>` | exit 0 |

</details>

계획의 QA 대응:

| QA 항목 | 근거 |
| --- | --- |
| `rehearse.sh`, 삭제 후 덤프 복원 건수 일치 | 리허설 표의 `audit-log/retire.json` 정상 행 |
| 계획의 두 jest 스펙 | 최종 head 통합 실행 안에서 통과 |
| 이관 누락 픽스처에서 삭제 0행으로 중단 | 리허설 표의 복사본 없는 신청 행, `audit-log-removal-migration.integration.spec.ts`의 `retire migration` 묶음 |

## 감사 화면

`/dashboard/audit-logs?actor=synthetic-72`를 Playwright Chromium에서 1440x900과 390x844로 열었다. 응답은 1단계 리허설의 적용 뒤 합성 덤프를 Before `97114d519`(#1758 head)는 그대로, After `5616da65f`는 #1756과 이 PR의 마이그레이션을 적용한 뒤 각 코드의 실제 서비스로 읽은 본문을 `page.route`로 돌려줬다.
`5616da65f` 뒤의 변경은 감사 화면 코드와 그 API를 건드리지 않는다.
두 응답 본문은 바이트까지 같고 표 캡처 두 PNG도 바이트까지 같다. 총 건수는 둘 다 86건이다. 요청은 `?actor=synthetic-72&page=1&limit=20`이고 페이지 오류·콘솔 오류·요청 실패는 0이다.

| 화면 | 이미지 |
| --- | --- |
| 표, Before 1440x900 | [https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-retire-before-element-audit-table.png](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-retire-before-element-audit-table.png) |
| 표, After 1440x900 | [https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-retire-after-element-audit-table.png](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-retire-after-element-audit-table.png) |
| After 전체 1440x900 | [https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-retire-after-desktop-audit-filter.png](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-retire-after-desktop-audit-filter.png) |
| After 전체 390x844 | [https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-retire-after-mobile-audit-filter.png](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-retire-after-mobile-audit-filter.png) |

## 수락 grep

```bash
git grep -nE "prisma\.auditLog|tx\.auditLog|writer\.auditLog|\.auditLog\.|'auditLog'|\"AuditLog\"|model AuditLog|AuditLogTransactionWriter" -- apps packages scripts .github \
  ':!apps/backend/prisma/migrations/**' ':!apps/backend/prisma/user-consolidation-*' ':!apps/backend/prisma/user-consolidation.*' \
  ':!apps/backend/prisma/team-application-merge.fixture.ts' ':!apps/backend/prisma/*migration*.integration.spec.ts' \
  ':!deploy/jenkins/user-consolidation/**' ':!deploy/jenkins/program-migration/**'
```

계획의 수락 기준(계획 l.240)이 제외하는 것은 과거 마이그레이션뿐이다. 위 명령의 `user-consolidation` 경로 제외는 계획의 제외가 아니다. 이 경로의 SQL을 남기는 근거는 두 가지다. 계획 l.172가 user-consolidation 스크립트 수정을 금지한다. 또 `deploy/jenkins/user-consolidation-watchdog-state.mjs:91-111`이 `manifest.json`의 sha256으로 preflight·reconcile·rollback SQL을 고정하므로, 이 파일을 바꾸면 모든 배포의 `--detect`가 실패한다. 이 SQL은 `--start`에서만 실행되고, 통합 마이그레이션 적용 뒤의 배포는 `ordinary`로 분류되어 실행하지 않는다.

위 명령의 제외만 두면 두 파일에서 8건이 남고, 두 파일을 더 제외하면 0건이다.

| 파일 | 건 | 제외 이유 |
| --- | --- | --- |
| `apps/backend/prisma/audit-log-removal-migration.fixture.ts` | 4 | 계획이 제외한 `audit-log-removal-migration.integration.spec.ts`의 fixture다. 격리된 fixture 스키마에 `AuditLog`를 만들어 1·2단계 마이그레이션을 검사한다 |
| `apps/backend/prisma/team-application-retirement.integration.spec.ts` | 4 | 지나간 마이그레이션 `20261105110000_retire_application_storage`를 fixture 스키마에서 다시 돌리는 스펙이다. 이름에 `migration`이 없어 계획의 패턴에 걸리지 않는다 |

## 남은 게이트

- #1756이 먼저 머지되어야 한다. 이 PR의 base는 그 브랜치다.
- 사람이 직접 누른 확인, 작성자 인터뷰 답변 세 개, 운영 화면 확인은 아직이다.
- 머지 후 배포와 배포 뒤 읽기 전용 검증은 아직이다. 이 작업은 머지·배포·릴리스를 하지 않는다.
- 최종 head에서 CI 잡 전체를 다시 재현하지 않았다. 위 표의 명령만 다시 돌렸다.
