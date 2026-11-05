# Todo 8 / 3c 단계 — 초대 종료를 행 삭제로 되돌린다

## 범위

`598cab9c4`의 되돌리기다. 네 종료 경로(팀장 취소, 수신자 거절, 수락, 다른 팀 합류에 따른 자동 종료)가 다시 `deleteMany`로 PENDING 행을 삭제한다. 네 경로 모두 같은 트랜잭션에서 `recordInvitationClosed`로 TeamHistory를 남기는 동작은 그대로 유지한다.

migration은 없다. 테이블·컬럼·enum을 지우지 않는다. 기존 종료 행의 이관과 `TeamInvitation_pending_only` CHECK는 다음 릴리스다.

## 왜 이 순서인가

3b 단계에서 독립 게이트가 삭제를 거절했다. 당시 직전 이미지 v0.24.44의 `hasActivity`는 TeamInvitation 행만 보았기 때문에, 삭제를 시작하면 초대만 받고 거절한 사용자가 활동 없는 것으로 보여 image rollback 뒤 등록 초기화가 잘못 허용될 수 있었다.

그래서 3b는 `updateMany`로 종료 행을 보존한 채 `hasActivity`의 TeamHistory 조회만 먼저 배포했다. 그 코드가 v0.24.49다. 이제 직전 이미지가 TeamHistory를 활동으로 읽으므로 삭제를 시작할 수 있다. 계약 15(c)의 읽기 전환 선행, 쓰기 중단 후행을 두 릴리스로 나눈 결과다.

image rollback 하한은 v0.24.49다. v0.24.44 이하로 되돌리면 삭제된 초대를 활동으로 셀 수 없다. 아래 회귀 테스트가 이 하한을 그대로 측정한다.

## 테스트

`member-registration-reset.integration.spec.ts`의 rollback 테스트를 3c 기준으로 다시 썼다. 거절 호출이 직접 행을 지우며 수동 `deleteMany` 보조를 제거했다. 현재 판정은 TeamHistory로 활동을 true로 보고 `ROL_025`로 초기화를 거부하며 학생 프로필이 유지된다. 같은 테스트에서 v0.24.44 fixture는 false를 반환하고 실제로 초기화에 성공하는 것까지 확인한다. 이는 허용 가능한 동작의 주장이 아니라 rollback 하한의 측정이다.

`program-team-membership.integration.spec.ts`의 수락·멤버 제거 경합 단정은 `fed8a8276`에서 terminal status를 기대하도록 고쳐졌으므로 다시 행이 사라지는 것을 기대하도록 맞췄다. 사용하지 않게 된 `TeamInvitationStatus` import를 제거했다.

단위 쪽 mock(`team-invitations.repository.acceptance.spec.ts`, `team-invitations.service.respond.spec.ts`)과 경합 통합(`team-invitations.acceptance-race.integration.spec.ts`)은 되돌리기로 함께 복원된다. 기존 종료 행을 읽거나 정리하는 테스트는 손대지 않았다.

## PR #1742 B1: 마지막 팀원 삭제의 초대 이력 보존

게이트가 검토한 기준은 `ecd97cbf8418b08c3bf6a47302f3599c0189213d`다. 신청 없는 팀의 마지막 학생 탈퇴와 교직원의 마지막 팀원 제외는 초대와 팀을 일괄 삭제하면서 이력을 기록하지 않았다. 서비스의 membership AuditLog 기록은 TeamHistory를 대신하지 않으므로 초대 당사자의 활동 사실도 잃을 수 있었다.

전용 팀 삭제 저장소에 있던 순회만 `TeamHistoryRepository.recordTeamInvitationsDeleted`로 옮겨 세 삭제 분기가 공유한다. 기존 트랜잭션과 팀 잠금 안에서 초대를 읽고, PENDING은 `INVITATION_CANCELLED`, ACCEPTED·DECLINED·EXPIRED는 기존 `archiveInvitation`을 통해 `INVITATION_ARCHIVED`로 기록한 뒤 일괄 삭제한다. 이미 보관한 terminal 초대는 기존 sourceTable/sourceId 이력을 유지한다. 새 파일·상수·스키마·migration은 없다. 추가 DI 인자에 맞춰 테스트 생성자 19곳을 연결했으며 팀장 승계와 `last-member-with-application` 분기는 바꾸지 않았다.

탈퇴의 actor는 탈퇴한 학생, 교직원 제외의 actor는 대상 학생이 아니라 실행한 교직원이다. 두 사건 모두 팀 자체가 삭제되므로 사유는 기존 삭제 경로와 같은 `TEAM_DELETED`다. 이력의 teamId·programId와 invitation.id·inviteeId·invitedById·createdAt을 보존하고 terminal 행은 원본 status·respondedAt·updatedAt도 보존한다. `schema.prisma`의 TeamHistory에는 Team relation이 없고, `20261104140000_prepare_team_history/migration.sql`도 이 식별자를 FK 없는 값으로 만든다. 실제 팀 행을 지운 뒤 이력 4개를 조회하는 통합 테스트로 잔존을 확인했다.

membership 통합 테스트의 기존 마지막 학생 탈퇴 사례를 학생·교직원 두 행으로 확장했다. 각 행은 PENDING 하나와 legacy terminal 세 개를 만들어 행 부재와 초대별 정확히 한 이력, actor·reason·원본 식별자·시각을 검증한다. 별도 네 행은 두 호출 경로 × pending/terminal writer에서 실제 이력 INSERT 후 실패를 주입한다. 전체 트랜잭션이 거부되고 팀·팀원·원본 초대가 복구되며 새 이력과 membership audit가 남지 않는 것을 검사한다. 테스트 전용 제품 seam은 추가하지 않았다.

## B1 red와 변이 증거

모든 통합 실행은 heavy lock을 잡고 아래 명령을 사용했다. runner가 매번 격리 DB를 새로 만들고 빈 DB부터 migrate deploy한 뒤 Docker 프로젝트·볼륨을 정리한다. pnpm shim은 의존성 재설치 확인을 끈다.

```sh
PATH=/tmp/pnpmshim:$PATH \
  npm_config_verify_deps_before_run=false \
  BACKEND_INTEGRATION_TEST_PATTERN='program-team-membership.integration.spec.ts$' \
  bash apps/backend/test/run-integration.sh
```

- `/tmp/b1-red.log`: 제품 수정 전 새 테스트 6 failed / 18 passed, `EXIT=1`. 두 성공 사례에서 이력이 4개 대신 0개였고 네 실패 주입 사례에서 호출이 reject되지 않았다.
- `/tmp/b1-green.log`: 수정 후 membership·전용 팀 삭제·초대 repository·acceptance race·eligibility·received summary·등록 초기화·지원 서비스 8 suites / 131 tests passed, `EXIT=0`. 첫 green 시도의 테스트 fixture가 같은 teamId의 이전 AuditLog를 재사용한 문제를 발견해 operation별 ID로 분리한 뒤 통과했다.
- `/tmp/b1-mutation.log`: `program-teams.repository.ts`의 학생 마지막 탈퇴 분기에서 새 `recordTeamInvitationsDeleted(tx, teamId, userId, now)` 호출만 제거했다. 위 명령에서 해당 탈퇴의 이력 개수와 두 롤백 사례가 실패했다: 3 failed / 21 passed, `EXIT=1`. 교직원 사례는 통과했다. 로그에는 변이 diff와 소스 SHA-256도 있다.

복원한 제품 파일 SHA-256은 `f681599c75c954026931036e44f9229aec2660363d268a2ca320dd5bdcfa7078`이다. `/tmp/b1-restored.log`에서 같은 소스 해시와 24 tests passed, `EXIT=0`을 함께 확인했다. 완료한 검증을 반복하지 말라는 후속 지시에 따라 커밋 후 통합 테스트를 다시 실행하지 않는다. `/tmp/b1-head-integration.log`는 첫 줄의 `HEAD=`와 소스 동일성 증거로 기존 실행을 최종 커밋에 연결하며, head 자체에서 새로 실행한 로그라고 주장하지 않는다.

최초 통합 green 로그에 기록한 worktree diff SHA-256은 `8af9ecf8a294b8efc3a3f6c28aa354df1193a7796d4d3fe5baf8172b1005aae5`다. 이후 바뀐 증거 문서와 HTTP 테스트 provider 등록 파일만 제외하고 최종 diff를 `--src-prefix=i/ --dst-prefix=w/`로 출력하면 같은 해시다. 제품 코드·통합 테스트·생성자 연결의 바이트가 실행 당시와 같다는 근거다. 제외한 HTTP 테스트는 이후 8건 green 및 전체 unit green으로 검증했다.

v0.24.49 image rollback 하한은 그대로다. 등록 초기화 repository/service는 v0.24.49와 diff가 없으며 TeamHistory의 actor와 invitation 당사자를 활동으로 센다. 이번 이력 보존은 그 reader가 마지막 팀 삭제 후에도 초대 사실을 볼 수 있게 한다. v0.24.44는 지원하지 않으며 실제 rollback image 부팅을 했다는 주장은 아니다. 이후 pending-only CHECK 적용과 terminal 행 이관은 여전히 다음 릴리스 경계다.

## B1 변경 범위와 검증 경계

| 제품 파일                           | 기준 줄 수 | 수정 줄 수 |
| ----------------------------------- | ---------: | ---------: |
| program-team-deletion.repository.ts |        362 |        345 |
| program-teams.repository.ts         |        973 |        987 |
| team-history.repository.ts          |         94 |        128 |

제품 파일 수는 같고 순증은 31줄이다. 파일 원장의 삭제·병합·유지 상태는 바뀌지 않는다. 생성자 DI 연결 외에 `program-team-activity.http.spec.ts`의 Nest 테스트 provider에도 TeamHistoryRepository를 등록했다. 전체 unit 첫 실행에서 이 provider 누락으로 8건이 실패한 것을 고친 뒤 같은 HTTP 테스트 8건이 통과했다.

`pnpm --config.verify-deps-before-run=false --filter backend test:unit --runInBand` 최종 실행은 389 suites / 6321 tests / 302 snapshots passed, `EXIT=0`이다(`/tmp/b1-unit-final.log`). 아래 명령도 같은 pnpm 옵션으로 실행하며 각 로그에 `COMMAND=`와 실제 `EXIT=`를 기록한다. 무거운 작업은 순차 실행하고 각 실행 사이 heavy lock을 해제한다.

| 명령                                                                                       | EXIT 영수증                      |
| ------------------------------------------------------------------------------------------ | -------------------------------- |
| `pnpm --filter frontend exec vitest run --maxWorkers=2 src/features/programs/applications` | `/tmp/b1-frontend-tests.log`     |
| `pnpm --filter backend typecheck`                                                          | `/tmp/b1-backend-typecheck.log`  |
| `pnpm --filter frontend typecheck`                                                         | `/tmp/b1-frontend-typecheck.log` |
| `pnpm --filter backend lint`                                                               | `/tmp/b1-backend-lint.log`       |
| `pnpm --filter frontend lint`                                                              | `/tmp/b1-frontend-lint.log`      |
| `pnpm lint:structure`                                                                      | `/tmp/b1-structure.log`          |
| `pnpm format:check`                                                                        | `/tmp/b1-format.log`             |
| `pnpm check:file-ledger`                                                                   | `/tmp/b1-file-ledger.log`        |

위 8개 명령의 최종 EXIT는 모두 0이다. 프론트 지원 흐름은 15 files / 229 tests passed다. backend lint의 기존 boundaries deprecation 안내와 변경하지 않은 frontend 테스트 두 파일의 링크 관련 경고 4건은 남아 있다. 경고를 숨기거나 설정을 완화하지 않았다.

운영 DB 접근·쓰기·집계·데이터 리허설은 하지 않았다. 운영의 비가역 삭제는 0건이고 스키마·테이블·컬럼 삭제도 0건이다. 데이터 migration이 없으므로 운영 데이터 리허설은 해당 없음이다. UI 변경이 없어 브라우저 QA는 해당 없음이며 원래 Todo 8의 화면 재설계를 이 B1 수정에 포함하지 않는다. stale_state는 매 통합 실행의 빈 DB migrate deploy로, dirty_worktree는 커밋 이후 상태와 실행 소스 diff 해시 대조로, misleading_success_output은 각 명령의 실제 EXIT로 확인한다. 동일 membership suite는 최초 green과 변이 복원 green으로 반복 관측했다.
