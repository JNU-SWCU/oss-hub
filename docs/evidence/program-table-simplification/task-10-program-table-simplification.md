# Todo 10 감사 로그의 도메인 이력 전환 검증 (1단계)

이 브랜치는 Todo 6 1단계 PR #1755 위에 있고, #1755는 Todo 9 PR #1754 위에 있다.
소유자가 정한 묶음에서 이 1단계는 #1754, #1755와 같은 릴리스로 나간다.
고아 행과 `AuditLog` 테이블 삭제는 2단계 draft PR이 그다음 릴리스에서 맡는다.

## 1단계가 바꾸는 것

- `ProgramHistory`를 만든다. 사건은 `CREATED`, `DELETED` 둘이다. `TeamHistoryEvent`에는 `CREATED`, `JOINED`, `REPOSITORY_PUBLISHED`를 더한다.
- 원본 대상이 남은 `AuditLog` 행은 `TeamHistory`·`ProgramHistory`로 복사하고 `("sourceTable", "sourceId")` 키로 대조한다. #1752가 이미 옮긴 신청 행과 사용자 도메인이 이미 가져간 행은 다시 복사하지 않는다.
- `GET /api/v1/audit-logs`는 팀·프로그램·사용자 이력의 UNION을 시간 역순으로 읽는다. 요청과 응답 형태, 수행자 필터, 쪽 크기는 그대로다.
- 제품 코드는 `AuditLog`에 쓰지 않는다. 프로그램 생성·삭제는 `ProgramHistory`, 팀 합류와 저장소 공개는 `TeamHistory`에 같은 트랜잭션으로 쓴다.
- 데이터 수집 수동 실행과 제출 파일 정리 재시도 초기화는 더 이상 기록하지 않는다. 계약 19와 남는 13개 테이블에 그 이력을 둘 곳이 없다.
- `AuditLog` 테이블과 행, append-only 트리거는 그대로 둔다. 1단계 마이그레이션 뒤 옛 이미지가 쓴 행은 2단계가 다시 경로를 정하고 복사한 뒤 지운다.

## 마이그레이션

| 마이그레이션 | sha256 |
| --- | --- |
| `20261105220000_prepare_audit_history_events` | `3434a4adb02b09e5b56a881e2073288f0c4875582978944d56d5ff17a9b7fbf8` |
| `20261105220100_copy_audit_log_to_domain_history` | `28fa8f0d3ffd54e72ecc7c5470916feee579c5b97cadaa6c311965b25988beb2` |

`20261105220100`은 `AuditLog`와 `TeamHistory`를 잠그고 행마다 경로를 정한다.
경로 없는 행, 이관되지 않은 신청 행, 가져오지 않은 사용자 행, 객체가 아닌 메타데이터가 하나라도 있으면 아무것도 만들지 않고 중단한다.
복사 뒤에는 팀·프로그램 복사본이 키로 모두 있는지와 경로를 받은 행 수가 원본 행 수와 같은지 대조하고, 다르면 전체를 되돌린다.
가드는 건수를 고정하지 않고 위 관계만 검사한다.

## 리허설

`bash deploy/jenkins/program-migration/rehearse.sh`와 실제 `prisma migrate deploy`를 운영 모양 합성 덤프에서 돌렸다.
이미지는 고정 digest의 `postgres:17-alpine`이고, 끝난 뒤 컨테이너가 남지 않은 것을 확인했다.
리허설 head는 `851c119b2`이고, 그 뒤 커밋은 마이그레이션과 매니페스트를 바꾸지 않았다. 위 두 해시가 그대로다.

| 경로 | 결과 |
| --- | --- |
| #1754 `20261105110000`, #1755 `20261105200000`, 이 PR 두 마이그레이션을 한 번의 `migrate deploy`로 | exit 0, 이 순서로 적용, `check-copy.sql` 불일치 0 |
| 적용 뒤 감사 화면 읽기 | 93건 전부 시간 역순, 순서 어긋남 0, 메타데이터 해석 실패 0, 수행자 필터 86건 |
| `audit-log/prepare.json` 정상 | exit 0, `REHEARSAL_OK`, 백업 복원 건수 네 개 일치(AuditLog 94, TeamHistory 105, Program 3, Team 33) |
| 경로 없는 행 1건, 리허설 | exit 1, 적용 전 `FAIL_CLOSED preflight failed` |
| 경로 없는 행 1건, 실제 `migrate deploy` | exit 1, 로그 원인 `AuditLog routing blocked: unrouted=1 ...`, `ProgramHistory` 없음, 다음 deploy P3009 |
| 복사 뒤 1건 유실 | exit 1, `FAIL_CLOSED reconcile failed: copy` |
| 복원본 건수 차이 | exit 1, `FAIL_CLOSED restored counts differ: 1` |

덤프 sha256: 적용 전 `cd002811e84fe3c3b4f22878d68370e4f61c9cd44e726f2d736bc9bf30bbaa17`,
`20261105200000` 적용 뒤 `b4830c4f5552af1f6ac1598d45576eebf828808dc8dd613ba65657edffff55c8`,
이 PR 적용 뒤 `3220f2359d50eccc42e60a23b5fe40db7c561b802535b6b09a810fda54e7fc2f`.

## 운영 데이터

2026-11-05T18:59:01Z에 읽기 전용 트랜잭션으로 운영 건수를 다시 읽었다. 건수만 읽었다.
head는 `20261105100100_merge_applications_into_teams`이고 미완료 마이그레이션은 0이다.
`AuditLog` 371행이 모두 경로를 받았고 경로 없는 행과 중단 경로는 0이다.

| 경로 | 행 | 1단계 처리 |
| --- | --- | --- |
| `ALREADY_IN_TEAM_HISTORY` | 73 | #1752가 옮긴 신청 행, 다시 복사하지 않음 |
| `IMPORTED_USER_DOMAIN` | 123 | 사용자 도메인이 가져간 행, 다시 복사하지 않음 |
| `MIGRATE_TEAM` | 63 | `TeamHistory`로 복사 |
| `MIGRATE_TEAM_DELETED_EVENT` | 1 | `TeamHistory` `DELETED`로 복사 |
| `MIGRATE_PROGRAM` | 7 | `ProgramHistory`로 복사 |
| `MIGRATE_PROGRAM_DELETED_EVENT` | 17 | `ProgramHistory` `DELETED`로 복사 |
| `MIGRATE_REPOSITORY` | 1 | `TeamHistory` `REPOSITORY_PUBLISHED`로 복사 |
| `DELETE_NO_TARGET` | 80 | 화면에서 빠짐, 2단계에서 삭제 |
| `DELETE_COLLECTION_SYNC` | 5 | 화면에서 빠짐, 2단계에서 삭제 |
| `DELETE_REPO_GONE` | 1 | 화면에서 빠짐, 2단계에서 삭제 |

`PROGRAM_ARCHIVED` 3행은 모두 대상 프로그램이 지워졌다.

## 최종 head 전체 검증

대상 코드 head는 1단계 `8e954ff4e`이다. #1755 `b26968b45`, #1754 `4e67914d4`, main `2039af172`를 포함한다. 이 뒤의 커밋은 이 문서만 더한다.
`CI=true`로 `.github/workflows/ci.yml`의 잡을 `8e954ff4e`에서 로컬로 재현했다. `<base>`는 `b26968b45`다. GitHub CI 결과를 근거로 삼지 않았다.
통합 테스트는 #1755가 기준선 fixture를 고친 head를 들인 뒤 돌렸고, 그 전에 실패하던 `program-read-baseline`과 `team-invitations` 스펙도 통과했다.

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
| `pnpm --filter backend test:unit` | exit 0 · Test Suites: 382 passed, 382 total / Tests: 6118 passed, 6118 total |
| `bash apps/backend/test/run-integration.test.sh` | exit 0 · Test Suites: 1 passed, 1 total / Tests: 1 passed, 1 total |
| `pnpm --filter backend build` | exit 0 |
| `pnpm --filter backend test:storage-reconcile` | exit 0 · Test Suites: 1 passed, 1 total / Tests: 5 passed, 5 total |
| `bun scripts/check-file-ledger.ts` | exit 0 · FILE_LEDGER_OK 272 paths |
| `pnpm exec commitlint --from <base> --to HEAD` | exit 0 |
| `bash .github/check-public-safe.test.sh` | exit 0 |
| `gitleaks git --log-opts=<base>..HEAD` | exit 0 · no leaks found |
| `bash .github/check-public-safe.sh <base>` | exit 0 |
| `pnpm --filter backend test:integration` | exit 0 · Test Suites: 158 passed, 158 total / Tests: 1270 passed, 1270 total |
| `BACKEND_INTEGRATION_TEST_PATTERN='src/platform/audit-history-read.integration.spec.ts\|prisma/audit-log-removal-migration.integration.spec.ts' bash apps/backend/test/run-integration.sh` | exit 0 · Test Suites: 2 passed, 2 total / Tests: 25 passed, 25 total |

계획의 QA 대응:

| QA 항목 | 근거 |
| --- | --- |
| `rehearse.sh` | 위 리허설 표 |
| 계획의 두 jest 스펙 | 바로 위 표의 마지막 행. 통합 DB가 필요해 저장소 통합 하네스로 돌렸다 |
| 복사 누락이면 중단 | `audit-log-removal-migration.integration.spec.ts`의 `aborts without copying on %s` 열 건과 `fails the copy check when a copied row is later altered or removed`, 리허설의 `복사 뒤 1건 유실` |
| 0행 삭제로 중단 | 1단계는 행을 지우지 않는다. 2단계 PR이 맡는다 |

## 감사 화면

`/dashboard/audit-logs?actor=synthetic-72`를 Playwright Chromium에서 열었다. 응답은 리허설 덤프를 Before `7f2341166`, After `8e954ff4e` 각각의 실제 서비스로 읽은 본문을 `page.route`로 돌려줬다.
`7f2341166`과 이 PR의 base `b26968b45`는 제품 코드가 같고 통합 스펙 하나만 다르다.
Before 코드가 읽지 못하는 합성 `AuditLog` 행 5건과 그 사용자 이력 복사본은 지우고 찍었다. 그중 2건은 #1752가 만든 `TeamHistory` 복사본이 남아 After 쪽 건수에 들어 있다.
Before는 `AuditLog`를 읽어 89건, After는 이력 UNION을 읽어 83건이다. After 첫 쪽에는 대상이 사라진 행과 데이터 수집 실행, 제출 파일 정리 재시도 행이 없다.
두 화면 모두 요청은 `?actor=synthetic-72&page=1&limit=20`이고 페이지 오류·콘솔 오류·요청 실패는 0이다.

| 화면 | 이미지 |
| --- | --- |
| 표, Before 1440x900 | [https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-before-element-audit-table.png](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-before-element-audit-table.png) |
| 표, After 1440x900 | [https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-after-element-audit-table.png](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-after-element-audit-table.png) |
| After 전체 1440x900 | [https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-after-desktop-audit-filter.png](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-after-desktop-audit-filter.png) |
| After 전체 390x844 | [https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-after-mobile-audit-filter.png](https://github.com/JNU-SWCU/oss-hub/releases/download/v0.24.58/-audit-history-after-mobile-audit-filter.png) |

## 남은 게이트

- 운영 덤프로 이 SQL을 리허설하지 않았다. 리허설은 운영 모양 합성 덤프다.
- 사람이 직접 누른 확인과 운영 화면 확인은 아직이다.
- 머지 후 배포와 읽기 전용 검증은 아직이다. 독립 게이트는 오케스트레이터의 머지 조건이고, 이 작업은 머지·배포·릴리스를 하지 않는다.
- 파일별 삭제 상태와 제품 파일 수는 [파일 원장](file-ledger.md)에 있다. `audit-log-read.repository.ts`는 UNION 조회를 맡아 남는다.
