# Todo 6 다음 릴리스의 옛 파일 테이블 삭제

1단계(File 생성·복사·코드 전환)가 운영에 배포된 뒤 별도 릴리스에서 적용한다. 두 단계를 같은 배포에 넣지 않는다.
소유자가 정한 묶음에서 이 단계는 Todo 10 2단계와 같은 릴리스다.
이 PR은 draft이며 머지·배포·Jenkins 실행을 수행하지 않았다.

## 삭제 대상과 보존 경계

| 대상 | 삭제 직전 고정 건수 | 처리 |
| --- | ---: | --- |
| SubmissionFile | 81 | 건수·storageKey 대조 후 테이블 삭제 |
| ProgramAuthoringUpload | 3 | 건수·storageKey 대조 후 테이블 삭제 |
| MilestoneDocumentTemplateFile | 5 | 건수·storageKey 대조 후 테이블 삭제 |
| ProgramCover | 3 | 건수·storageKey 대조 후 테이블 삭제 |
| ProgramPurgeFileTombstone | 2 | 건수·storageKey 대조 후 테이블 삭제 |

함께 지우는 것은 함수 `reject_retired_file_write`와 enum 넷(`SubmissionFileLifecycle`,
`ProgramAuthoringUploadLifecycle`, `ProgramPurgeFileTombstoneLifecycle`, `ProgramCoverSource`)이다.
함께 더하는 것은 `File_kind_lifecycle_check`와 `Program_cover_file_or_external_check`다.
File 92행과 Program은 지우지 않는다. 제품 파일 수는 1단계와 같다.

## 멈추는 조건

마이그레이션 `20261105225000_retire_file_tables`(sha256 `837652646e270fa619ef8c4cf27e84093b06313e305e58014868082f4a3423aa`)는 지우기 전에 두 가지를 본다.
처음 이름은 `20261105210000_retire_file_tables`였다. R2가 적용되면 그 이름이 `20261105220100_copy_audit_log_to_domain_history`보다 앞에 끼어 Jenkins 원장 점검이 `noncontiguous-migration-ledger`로 멈추므로 이름만 R2 뒤로 옮겼고 SQL과 해시는 같다.

- 원본 건수가 `81, 3, 5, 3, 2` 또는 전부 0이 아니면 `file retire aborted: source count mismatch`로 멈춘다.
- 원본 storageKey가 File에 없으면 `file retire aborted: ... source storage keys are missing from File`로 멈춘다.

전부 0을 허용하는 까닭은 원본 행이 없는 새 DB에서도 같은 마이그레이션을 적용해야 하기 때문이다.
마이그레이션은 한 트랜잭션이라 멈추면 아무것도 지워지지 않는다.

## 최종 head 전체 검증

R2(v0.24.59)가 배포된 main `f8dfbbed5`를 병합하고 `files/retire.json`의 시작 head를 옮긴 head `ea990e7f3`에서 소유자가 정한 범위대로 아래만 돌렸다. 이 뒤의 커밋은 문서만 바꾼다.
통합 테스트 DB는 `20261105220000`, `20261105220100` 다음에 `20261105225000_retire_file_tables`를 적용했다.
전체 통합 실행과 운영 복제본 리허설은 main, 이 PR, Todo 10 2단계를 합친 head에서 Todo 10 레인이 한 번 돌린다.

| 명령 | 결과 |
| --- | --- |
| `pnpm --filter backend exec prisma generate` | exit 0 |
| `pnpm --filter backend typecheck` | exit 0 |
| `node --test deploy/jenkins/program-migration/*.test.mjs` | exit 0 · 46 pass / 0 fail |
| `node --test deploy/jenkins/user-consolidation*.test.mjs` | exit 0 · 90 pass / 0 fail |
| `pnpm --filter backend test:integration` (`file-retirement-migration`, `team-application-retirement`, `program-external-cover`, `audit-log-removal-migration` 네 spec) | exit 0 · Test Suites: 4 passed, 4 total / Tests: 52 passed, 52 total |

아래 전체 표는 #1754를 합치기 전 head의 기록이다. 대상 코드 head는 2단계 `18109f177`, 1단계 `86d085829`, 팀 브랜치 `84b295d04`다.
`CI=true`로 `.github/workflows/ci.yml`의 잡을 로컬에서 재현했다. GitHub CI 결과를 근거로 삼지 않았다.

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
| `pnpm --filter frontend test --maxWorkers=2` | exit 0 · Test Files 440 passed (440) / Tests 4739 passed (4739) |
| `pnpm --filter frontend build` | exit 0 |
| `pnpm --filter backend lint` | exit 0 |
| `pnpm --filter backend typecheck` | exit 0 |
| `pnpm --filter backend test:unit` | exit 0 · Test Suites: 382 passed, 382 total / Tests: 6118 passed, 6118 total |
| `bash apps/backend/test/run-integration.test.sh` | exit 0 · Test Suites: 1 passed, 1 total / Tests: 1 passed, 1 total |
| `pnpm --filter backend build` | exit 0 |
| `pnpm --filter backend test:storage-reconcile` | exit 0 · Test Suites: 1 passed, 1 total / Tests: 5 passed, 5 total |
| `bun scripts/check-file-ledger.ts` | exit 0 · FILE_LEDGER_OK 271 paths |
| `pnpm exec commitlint --from <base> --to HEAD` | exit 0 |
| `bash .github/check-public-safe.test.sh` | exit 0 |
| `gitleaks git --log-opts=<base>..HEAD` | exit 0 · no leaks found |
| `bash .github/check-public-safe.sh <base>` | exit 0 |
| `pnpm --filter backend test:integration` | exit 0 · Test Suites: 157 passed, 157 total / Tests: 1246 passed, 1246 total |

## 리허설

현재 SQL은 #1754와 1단계를 실제로 적용한 덤프에서 시작해 로컬 합성 데이터로만 리허설했다. 절차와 중단 경로 결과는
[서버 리허설](task-6-server-rehearsal.md)의 첫 절에 있다. 그때 `files/retire.json`의 시작 head는 `20261105200000_unify_files`였다.
R2가 배포되어 운영 원장 head가 `20261105220100_copy_audit_log_to_domain_history`가 되었으므로 시작 head를 그 이름으로 옮겼다.
현재 SQL의 운영 복제본 리허설은 이 레인에서 돌리지 않았고, Todo 10 2단계와 합친 head에서 Todo 10 레인이 한 번 돌린다.

## 남은 게이트

- 1단계는 R2(v0.24.59)로 운영에 배포되었다. 이 PR은 Todo 10 2단계와 같은 R3로만 내보낸다.
- 코드가 강제하는 멈춤은 마이그레이션의 건수·storageKey guard뿐이다.
- 합친 head의 전체 통합 실행과 운영 복제본 리허설은 Todo 10 레인의 결과로 확인한다.
- 기준선 재측정은 소유자 결정에 따라 마이그레이션이 모두 끝난 뒤 한 번만 한다.
- 머지 후 배포와 읽기 전용 검증은 아직이다.
