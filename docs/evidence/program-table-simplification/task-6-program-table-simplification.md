# Todo 6 File 전환 검증

구현 시작 기준 main: `1d8e9259ff4afc95cd4fc97a401f639dd3de16de`.
이 브랜치는 Todo 9 PR #1752 위에 쌓여 있고 그 PR이 먼저 머지되어야 한다.
첫 릴리스는 File 생성·복사·대조·코드 전환이다. 옛 테이블 삭제와
kind × lifecycle CHECK는 다음 릴리스의 draft PR에 둔다. 소유자가 정한 묶음에서 이 단계는
#1754, Todo 10 1단계와 같은 릴리스이고, 2단계는 Todo 10 2단계와 함께 그다음 릴리스다.

## 바뀌는 저장과 유지하는 경계

- 업로드 토큰·양식·자체 커버·제출 파일·삭제 툼스톤은 File을 사용한다.
  storageKey는 유니크하며 소모한 업로드는 같은 행에서 TEMPLATE 또는 COVER로 전환한다.
- 외부 커버는 Program의 URL 컬럼이다. 스토리지 소유권이나 File 행을 만들지 않는다.
- 삭제 큐는 임대, CAS, 실패 횟수, 다음 시각을 한 워커에서 처리한다.
  프로그램 삭제 스냅샷 뒤에 연결된 커버·양식도 DELETED 소유자를 보고 회수한다.
- 스토리지 삭제 실패만 삭제 재시도 횟수에 반영한다. 삭제 완료를 DB에 기록하지
  못한 오류는 호출자에게 전달하며 스토리지 실패로 바꾸지 않는다.
- 기존 HTTP 경로, 권한, 업로드 제한을 유지한다.
- 응답이 바뀌는 곳은 프로그램 삭제의 `deletedCounts` 하나다. `submissionFiles`,
  `milestoneDocumentTemplateFiles`, `programAuthoringUploads`,
  `programPurgeFileTombstones` 네 필드를 지우고 File의 실제 정리 대상을 세는 `files`로
  합쳤다. 프론트의 삭제 안내는 `파일 삭제 대기 N건` 한 묶음만 보여 준다.
- `deploy/jenkins/smoke-release.sh`가 사용하는
  `/api/v1/milestone-document-files` 경로도 유지한다.

## 구현 중 선택 실행과 실패 수정

아래는 구현 중의 선택 실행 기록이다. 서로 겹치는 케이스가 있어 합계로 제시하지 않는다.
최종 head의 전체 실행은 [최종 head 전체 검증](#최종-head-전체-검증)에 있다.

| 경계 | 선택 실행 결과 |
| --- | --- |
| 파일 변경 관련 단위 | 47 파일, 550 케이스에서 발견한 6개 실패를 수정하고 해당 파일 재실행 |
| 메타데이터 변환 소비자 | 17 파일, 356 케이스. 옛 Prisma mock 형태의 실패를 수정하고 두 파일 재실행 |
| 마지막 저장소 재실행 | `milestone-documents.repository.spec.ts` 80 케이스 통과 |
| 인증 인벤토리·컨트롤러·업로드 모듈 | 8 파일, 185 케이스 통과 |
| 실제 업로드·현재 파일 접근 권한 | 2 파일, 45 케이스 통과 |
| 팀 삭제·외부 커버 | 2 파일, 35 케이스 통과 |
| 늦은 첨부·생명주기·고아 대조·시드 | 4 파일의 34 케이스 통과. 시드 cleanup FK 실패는 별도 18 케이스 재실행으로 수정 확인 |

시드 cleanup은 기존의 제출 파일 보호 조건에 TEMPLATE까지 섞어 마일스톤을
남겼다. SUBMISSION 종류로 범위를 바로잡았고 cleanup 실패 시에도 연결을 해제한다.
제출 소유권, 이력 연결, 마감·동시성, 트랜잭션, 스토리지 키 비노출 검증은 유지했다.

## Mutation

`FileCleanupRepository.claimNextForDeletion`의 DELETED 프로그램 소유자 분기
세 곳을 일시적으로 무효화했다. 실제 DB의 늦은 커버·양식 테스트 두 개가
각각 객체가 남아 있다는 이유로 실패했다.

```text
Test Suites: 1 failed, 1 total
Tests:       2 failed, 2 total
Expected: false
Received: true
MUTATION_TEST_EXIT=1
```

원본 바이트를 복원한 뒤 같은 두 테스트가 통과했다. 복원한 저장소 파일의
SHA-256은 `f1e6f421d39e2c37cb57771816b2c04cbbb43976925c14d6fed0e8541b0b0233`이다.
mutant는 커밋하지 않는다.

재현 명령:

```sh
BACKEND_INTEGRATION_TEST_PATTERN='file-late-attachment\.integration\.spec\.ts$' \
  bash apps/backend/test/run-integration.sh
```

## 정적 검사

공유 Prisma Client는 heavy lock 안에서 이 worktree의 스키마로 생성하고,
생성 결과를 사용하는 검사까지 같은 lock을 유지했다.

```text
TYPECHECK_EXIT=0
LINT_EXIT=0
FORMAT_EXIT=0
FILE_LEDGER_OK 271 paths
LEDGER_EXIT=0
FINAL_STATIC_EXIT=0
```

`pnpm lint:structure`도 종료 코드 0이다. 의존성 자동 설치를 막기 위해
`pnpm --config.verify-deps-before-run=false`를 사용했다.

빈 격리 DB에 전체 마이그레이션을 적용한 뒤 선택 통합 테스트를 실행했다.
예상한 테스트 수와 종료 코드를 함께 확인했으며, 실패를 무시하는 재시도나
테스트 skip은 추가하지 않았다. 실패 파일은 원인을 수정한 뒤 재실행했다.

## 최종 head 전체 검증

대상 코드 head는 1단계 `86d085829`, 팀 브랜치 `84b295d04`다. 이 뒤의 커밋은 문서만 바꾼다.
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
| `pnpm --filter backend test:integration` | exit 0 · Test Suites: 156 passed, 156 total / Tests: 1237 passed, 1237 total |
| `pnpm --filter frontend e2e` (`program-edit-purge-network`) | exit 0 · 9 passed |

앞선 실패 16건은 모두 팀 브랜치에서 온 것이었다. 같은 팀 head에서 Todo 9 레인의 실패 이름과 대조해
겹치는 것을 확인했고, 팀 브랜치가 고친 뒤 위 전체 실행에서 사라졌다.

계획의 QA 대응:

| QA 항목 | 테스트 |
| --- | --- |
| 업로드 → 제출 → DELETE_PENDING → DELETED | `submission-file-lifecycle.integration.spec.ts`의 `moves expired ATTACHED through DELETE_PENDING to DELETED with the real object removed` |
| 행 수 대조 | `file-unification-migration.integration.spec.ts`의 `copies 94 source rows into 92 unique files without losing shared upload metadata` |
| kind 위반 INSERT 거부 | 같은 파일의 `File_kind_owner_check` 단정 네 건. `kind × lifecycle`은 2단계의 `file-retirement-migration.integration.spec.ts` |
| 스토리지 삭제 실패 시 시도 횟수 증가 | `records one attempt and keeps the row when the worker storage delete fails` |
| 삭제 스냅샷 뒤 늦은 커버·양식 회수 | `file-late-attachment.integration.spec.ts`의 세 테스트 |
| 고아 대조 CLI | `pnpm --filter backend test:storage-reconcile` |

## 운영 데이터와 남은 게이트

리허설은 [서버 리허설](task-6-server-rehearsal.md)에 있다. 현재 SQL은 로컬 합성 데이터로만
리허설했고, 운영 덤프 리허설의 해시는 옛 SQL이다. 배포 전에 현재 SQL로 다시 실행해야 한다.
파일별 삭제·병합 상태와 208 → 194개 제품 파일 수는 [파일 원장](file-ledger.md)에 기록했다.

성능은 소유자의 최종 지시에 따라 PR별 검증 대상에서 제외했다. 계획의 기준선 재측정도
소유자 결정에 따라 마이그레이션이 모두 끝난 뒤 한 번만 하므로 이 PR에서 수행하지 않았다.
계획의 수용 조건 중 머지 후 배포와 읽기 전용 검증은 아직이다.
독립 게이트는 오케스트레이터의 머지 조건이다. 이 작업은 머지·배포·릴리스를 수행하지 않는다.
