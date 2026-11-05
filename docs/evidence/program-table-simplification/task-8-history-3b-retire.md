# Todo 8 3b 데이터 이관

## 2026-11-05 병합 준비

main `ed413a92dd8930b9ec0b1feecbd18a096aa59cde`(v0.24.51, #1742 포함)에 rebase했다. 충돌은 없었다. `program-purge.integration.spec.ts`의 미사용 `TeamInvitationStatus` import를 제거했다. #1742가 추가한 마지막 팀원 탈퇴·교직원 제거 테스트는 종료 초대를 직접 생성하므로 새 CHECK에서 실패했다. 재현은 1 suite / 4 failed / 20 passed / 24 total, `RED_INTEGRATION_EXIT=1`이다.

종료 픽스처는 실제 이관 후 구조인 TeamHistory에 원본 세 상태의 사실을 넣고 삭제 후 행 전체가 동일한지 검사한다. 대기 취소 이력의 행위자와 데이터 검증은 유지한다. 실패 원자성 테스트는 더 이상 생성할 수 없는 EXPIRED 쓰기 대신 실제 마지막 팀원 경로의 `recordTeamInvitationsDeleted` 실패를 주입한다. 테스트 삭제·skip·CHECK 해제는 없다.

제품 코드는 #1742와 같다. 마지막 팀원 두 경로와 교직원 팀 삭제는 `recordTeamInvitationsDeleted`를 호출한 뒤 초대 행을 삭제한다. 전체 backend 제품 소스에서 초대 create/createMany 두 곳은 기본 PENDING만 만들고 update/upsert와 terminal status 쓰기는 없다. 수락·거절·취소의 행 삭제와 TeamHistory 기록을 유지한다.

main의 마지막 migration은 `20261104180000_prepare_invitation_archival`이며 retire manifest의 expected head와 같다. `20261104190000_retire_terminal_invitations`는 그 뒤에 정렬된다. SQL은 수정하지 않았고 SHA-256은 `1fa708e4fd21d770a9edf2a02e40d5a3169ba8095630b5114a88a4a117bed485`다. 기존 서버 내부 리허설 결과를 유지하며 이번에는 리허설을 다시 실행하지 않았다. 아래 과거 image rollback 설명보다 2026-11-05 소유자 결정이 우선한다. 전환 오류를 허용하고 복구는 백업 복원이며 구 이미지 호환 작업은 추가하지 않는다.

2026-11-05 운영 읽기 전용 재집계 `PRODUCTION_RECOUNT_EXIT=0`: ACCEPTED 20, DECLINED 5, PENDING 3, 종료 합계 25, 팀 40, 구성원 72, Preparation 0, participant 0. 운영 migration head도 `20261104180000_prepare_invitation_archival`이었다. 승인 수량과 차이는 없고 SQL 가드는 변경하지 않았다. 운영 쓰기·배포·merge는 하지 않았다.

최종 타깃 통합은 `BACKEND_INTEGRATION_TEST_PATTERN='(terminal-invitation-migration|program-team-membership|program-purge|program-team-deletion|team-invitations.received-summary|team-invitations.repository)\.integration\.spec\.ts$' bash apps/backend/test/run-integration.sh`로 실행했다. 6 suites / 127 tests 통과, `TARGETED_INTEGRATION_EXIT=0`이다. 새 빈 DB에 모든 migration 적용도 이 실행에서 성공했다. 전체 suite는 이번에 실행하지 않으며 CI 관문으로 남긴다.

타깃 통합 뒤 backend typecheck와 lint를 순서대로 실행해 `BACKEND_TYPECHECK_EXIT=0`, `BACKEND_LINT_EXIT=0`을 확인했다. 루트 format:check, lint:structure, check:file-ledger도 각각 `FORMAT_CHECK_EXIT=0`, `STRUCTURE_EXIT=0`, `FILE_LEDGER_EXIT=0`이다. 기존 boundaries mode 폐기 예정 경고와 원장 실행의 package type 경고는 남아 있으나 오류는 없다. dirty worktree에는 이번 수정 네 파일만 있었으며 의미 없는 성공 출력은 실제 6 suites / 127 tests 수로 배제했다. flaky 재시도는 하지 않았고 새 타깃 실행은 한 번에 통과했다.

정리 검사에서 이 worktree 라벨의 잔존 Docker 컨테이너는 0개다. 각 격리 runner가 컨테이너·볼륨·네트워크를 정리한 뒤 EXIT=0으로 끝났다. 별도 서버·브라우저·운영 임시 자원을 만들지 않았다. PR 본문 임시 파일은 게시 후 제거한다. #1745가 작업 중 main `48f0fb76f`에 추가됐으며, 이 PR의 검증 기준은 요청받은 `ed413a92d`다. #1745는 새 migration을 추가하지 않으며 최종 통합 CI와 독립 gate가 병합 관문이다.

이 draft는 코드 선행 PR #1738과 종료 시 행 삭제 PR #1742가 모두 운영에 배포되고 구 writer가 종료된 뒤에만 적용한다. migration의 선행 head는 `20261104180000_prepare_invitation_archival`이다. 물리 컬럼·테이블 DROP은 포함하지 않는다.

## 예상 이동과 대조

기존 운영 읽기 전용 조회의 승인 기준은 Preparation 두 테이블 0, 종료 초대 25, 해당 종료 이력 0, 대기 초대 3, 팀 40, 구성원 72다. 이번 게이트 수정에서는 운영에 연결하지 않았다. SQL도 같은 트랜잭션에서 종료 25 / ACCEPTED 20 / DECLINED 5 / PENDING 3 / 팀 40 / 구성원 72를 강제하며, 다르면 이력 INSERT와 초대 DELETE 전에 중단한다. 실제 새 이력 INSERT가 25건이 아니어도 예외로 전체를 롤백한다.

| 항목          |  전 |      변경 |  후 |
| ------------- | --: | --------: | --: |
| TeamHistory   |   0 | 25 INSERT |  25 |
| ACCEPTED 초대 |  20 | 20 DELETE |   0 |
| DECLINED 초대 |   5 |  5 DELETE |   0 |
| 전체 초대     |  28 | 25 DELETE |   3 |
| PENDING 초대  |   3 |         0 |   3 |
| 팀            |  40 |         0 |  40 |
| 구성원        |  72 |         0 |  72 |

기존 종료 사실은 INVITATION_ARCHIVED/source=MIGRATION, actorId=null로 보존한다. 원본 status와 createdAt/respondedAt/updatedAt, team/program/초대 당사자 ID를 그대로 저장한다. occurredAt은 보관 사건의 시각이며 과거 거절·취소 행위자를 추정하지 않는다. 이미 올바른 이력이 있는 sourceTable/sourceId는 덮어쓰지 않으며, 그로 인해 신규 INSERT가 25건 미만이면 승인 기준과 달라 전체를 롤백한다.

Team→TeamMember→TeamInvitation→TeamHistory 순서의 SHARE ROW EXCLUSIVE 테이블 잠금으로 집계 이후 동시 쓰기까지 막고 승인 건수를 검사한다. 이력을 쓰고 원본과 대조한 뒤 종료 행만 지운다. 충돌·누락·외래키 추가·pending 이력 모순이 있으면 전체 트랜잭션이 실패한다. 마지막에 pending-only CHECK를 추가해 옛 status 갱신 writer를 거부한다.

무변경 경로는 두 가지다. 초대·팀·구성원과 초대 출처 이력이 모두 없는 새 DB는 데이터 쓰기 없이 CHECK만 설치한다. 검증된 pending-only CHECK가 이미 있고 종료 초대가 0인 재실행은 데이터 쓰기를 건너뛴다. CHECK 없이 대기 초대만 남은 상태는 재실행으로 간주하지 않는다. 25건이어도 ACCEPTED/DECLINED 비율, EXPIRED 포함 여부 또는 PENDING·팀·구성원 건수가 승인과 다르면 거부한다. 이 고정 범위가 운영에서 달라지면 새 집계와 승인이 필요하다.

## 롤백 하한

안전한 image rollback 하한은 #1738 코드 선행 릴리스다. 그 앱은 이력으로 활동을 판단하고 새 종료를 삭제하므로 이관 후에도 동작해야 하며 실제 전신 코드로 검증한다.

v0.24.44는 스키마가 열려도 의미상 안전하지 않다. 초대만 있던 사용자의 활동 판정을 잃어 등록 초기화가 허용된다. pending-only CHECK 뒤에는 ACCEPTED/DECLINED로 바꾸는 기존 종료 쓰기도 실패한다. 삭제된 초대 재시도는 not-pending 대신 not-found(TIV_010)다. 필요하면 승인된 백업 복원으로 복구하며 v0.24.44를 그대로 image rollback하지 않는다.

#1738의 Preparation CHECK(false) 때문에 v0.24.44 미만 앱의 준비 생성은 실패할 수 있다. v0.24.44 이상은 새 준비를 생성하지 않는다. 데이터 이관과 무관하게 별도로 공개한 한계다.

## 검증 상태

2026-11-04 로컬 격리 PostgreSQL 타깃 검증: 1 suite / 21 tests 통과, EXIT=0. 정상 데이터는 초대 28→3, 새 이력 25, 팀 40과 구성원 72를 확인한다. 24건과 26건은 승인 수량 예외 후 초대·이력 원본 JSON과 CHECK 부재를 확인한다. 기존 종료 이력이 하나 있는 경우에는 24건 INSERT 이후 예외가 발생해 신규 이력까지 롤백되는지 확인한다.

음성 검증은 실제 migration.sql에서 승인 수량 IF와 신규 INSERT 수량 IF를 제거한 뒤 같은 테스트를 실행했다. 24·26건 모두 예외 대신 성공하여 두 테스트가 실패했다. 전체 타깃은 13 failed / 8 passed / 21 total, EXIT=1이었다. 검증 후 SQL을 바이트 단위로 복원했으며 SHA-256은 `1fa708e4fd21d770a9edf2a02e40d5a3169ba8095630b5114a88a4a117bed485`다.

원격 PR의 기존 가드는 복사·삭제 수를 입력에서 구한 terminal_count와 비교했기 때문에 24·26건에서도 같은 수가 나와 통과했다. 작업 시작 시 로컬 미push 커밋에는 25/20/5/3 가드와 purge 공통 픽스처 수정이 이미 있었다. 이번에는 팀·구성원·신규 INSERT 가드와 실제 DB 음성 검증을 보강했다. purge의 ACCEPTED 초대는 TeamHistory로 옮기고 별도 PENDING 초대를 유지한 공통 픽스처를 보존했다. 자식 행 수와 이력 내용의 삭제 전후 동등성 검증도 유지한다.

`git fetch origin main` 후 `origin/main`의 `7f4d94597a8f78ee711c8d65cbcf3eaf8d53a99b`에 rebase했다. 이 rebase에서 #1738과 #1728의 커밋 6건이 이미 적용된 것으로 떨어져 이 PR은 이관 커밋 4건만 남았다. main의 마지막 디렉터리가 `20261104180000_prepare_invitation_archival`이 되었으므로 디렉터리를 `20261104190000_retire_terminal_invitations`로 바꿔 운영 ledger가 연속이 되도록 했다. 이름 변경 전후 SQL SHA-256은 모두 `1fa708e4fd21d770a9edf2a02e40d5a3169ba8095630b5114a88a4a117bed485`이며 바이트는 바뀌지 않았다. SQL 변경은 승인 가드와 그 검사를 위한 잠금·빈 DB 판정에 한정한다.

첫 전체 통합 실행은 151 suites 중 2 failed / 149 passed, 1190 tests 중 3 failed / 1187 passed, EXIT=1이었다. rebase로 들어온 팀 삭제의 EXPIRED 행과 저장소 테스트의 DECLINED 직접 갱신 두 건이 pending-only 제약에 걸렸다. 만료 사실은 기존 TeamHistory로 준비하고 팀 삭제 뒤 내용이 그대로인지 확인하도록 수정했다. 직접 status 갱신은 제약으로 거부되고 PENDING 행은 보존되는지 확인한다. 재초대 뒤 구 writer의 status 갱신도 거부되는 계약을 검증한다. 수신 초대 요약의 과거 DECLINED 픽스처도 이력으로 옮겨 대기 초대 두 건만 목록에 나타나는 검증을 유지했다.

추가 수정한 팀 삭제·초대 저장소·수신 초대 요약의 격리 PostgreSQL 타깃 검증은 3 suites / 59 tests 통과, EXIT=0이다. 테스트 삭제·skip·제약 해제 없이 보정했다.

수정 후 전체 backend 통합 suite는 151 suites / 1190 tests 모두 통과, EXIT=0이다. 모든 테스트 명령은 `/tmp/oss-hub-heavy.lock`을 획득한 뒤 순차 실행했으며 `npm_config_verify_deps_before_run=false`를 내보냈다. 통합 runner는 Jest `--runInBand`와 격리 PostgreSQL·객체 저장소를 사용하고 종료 시 compose `down -v --remove-orphans`를 수행했다.

그 뒤 전체 backend 단위 suite를 `pnpm --config.verify-deps-before-run=false --filter backend test:unit --maxWorkers=2`로 같은 잠금 안에서 실행했다. 389 suites / 6321 tests 모두 통과, EXIT=0이다.

호스트 정리: 지정 worktree의 compose working-directory 라벨로 조회한 잔존 컨테이너는 0개다. 통합 runner의 볼륨·네트워크 정리까지 끝난 EXIT=0을 확인했다. 별도 서버·브라우저·임시 디렉터리는 만들지 않았고 테스트 잠금은 각 명령 종료 때 해제했다. 다른 worktree의 실행과 Docker 자원은 유지했다.

이 문서의 최초 draft 공개 시점에는 서버 리허설과 status reader 제거 최종 검증은 아직 진행 중이다. 운영 데이터 쓰기·merge·배포는 하지 않는다. 서버 리허설은 운영 dump를 서버 내부 tmpfs 기반 --rm 컨테이너로만 복원하고 결과와 정리 영수증을 여기에 추가한다.

## 인계 후 직접 확인한 음성 검증

2026-11-04 인계 시 실제 HEAD와 원격 브랜치는 모두 `78a78659417a39f514e79b7fca430bb20589f3a4`였고 미커밋 변경은 없었다. 여섯 파일의 전체 커밋 diff를 읽은 뒤 `git push --no-verify`가 `Everything up-to-date`로 끝난 것을 확인했다. 미push라는 인계 설명보다 실제 저장소 상태를 기준으로 진행했다.

운영 코드 두 곳만 임시로 변형했다. SQL의 `Invitation approval count mismatch` 조건 전체를 `FALSE AND (...)`로 막았고, 팀 삭제 저장소의 `INVITATION_CANCELLED` 기록에 교직원 `actorId` 대신 `invitation.invitedById`를 전달했다. 테스트는 수정하지 않았다. `BACKEND_INTEGRATION_TEST_PATTERN='(terminal-invitation-migration|program-team-deletion)\.integration\.spec\.ts$' pnpm --config.verify-deps-before-run=false --filter backend test:integration`을 격리 DB에서 실행했다.

```text
FAIL src/programs/program-team-deletion.integration.spec.ts
  3b staff deletion records every pending cancellation and preserves archived history
  - "actorId": "synthetic-team-deletion:staff"
  + "actorId": "synthetic-team-deletion:leader"
FAIL prisma/terminal-invitation-migration.integration.spec.ts
  rejects an unapproved status split or inventory count: DELETE FROM "Team" WHERE id = 'team-40'
  Received promise resolved instead of rejected
Test Suites: 2 failed, 2 total
Tests:       13 failed, 30 passed, 43 total
MUTATION_RED_EXIT=1
```

SQL 가드만 무력화했으므로 승인 INSERT 가드는 그대로다. 종료 24·26건은 각각 `Invitation approval insert count mismatch: copied=24; expected 25`와 `copied=26; expected 25`가 발생해 기대한 선행 수량 예외와 달라 실패했다. 상태 비율·대기 수·팀·구성원 변형 아홉 건은 예외 없이 완료되어 실패했다. 이 결과는 두 가드가 서로 다른 불변식을 검사함을 보여준다.

두 운영 파일을 바이트 단위로 복원한 뒤 같은 명령을 실행했다.

```text
PASS src/programs/program-team-deletion.integration.spec.ts
PASS prisma/terminal-invitation-migration.integration.spec.ts
Test Suites: 2 passed, 2 total
Tests:       43 passed, 43 total
MUTATION_GREEN_EXIT=0
```

복원 SHA-256은 SQL `1fa708e4fd21d770a9edf2a02e40d5a3169ba8095630b5114a88a4a117bed485`, 팀 삭제 저장소 `30b1e385d0880de4f06003f0da6c4a80ac7c4a9ae3879cfb74867e34af003b69`이며 변형 전과 같다. 두 실행 모두 mkdir 잠금과 EXIT trap으로 직렬화했고 실패 때도 잠금을 해제했다. 의존성 검증은 환경변수와 명령 옵션으로 비활성화했다.

운영 수량은 이번 인계에서 재조회하지 않았다. `task-8-history-3b-code.md`의 2026-11-04 읽기 전용 실측(EXIT=0)이 출처이며, 신규 이력 25건(수락 20 + 거절 5), 초대 28→3, 대기 3·팀 40·구성원 72 유지가 소유자 승인 대상이다. 운영 연결·쓰기·merge·배포는 수행하지 않았다.

## 인계 후 전체 게이트

동일한 복원 코드에서 전체 단위 테스트를 다시 실행했다. `/tmp/oss-hub-heavy.lock`을 mkdir로 획득한 뒤 EXIT trap으로 해제했으며 `npm_config_verify_deps_before_run=false`를 내보냈다.

```text
pnpm --config.verify-deps-before-run=false --filter backend test:unit --maxWorkers=2
Test Suites: 389 passed, 389 total
Tests:       6321 passed, 6321 total
FULL_UNIT_EXIT=0
```

단위 테스트가 끝난 뒤 잠금을 새로 획득하고 `BACKEND_INTEGRATION_TEST_PATTERN`을 unset하여 전체 통합 테스트를 실행했다. 통합 runner의 `--runInBand`로 한 worker만 사용했다.

```text
pnpm --config.verify-deps-before-run=false --filter backend test:integration
Test Suites: 151 passed, 151 total
Tests:       1190 passed, 1190 total
FULL_INTEGRATION_EXIT=0
```

마지막 실행의 compose project는 `oss-hub-test-1793804542-48276-13747`이고 PostgreSQL·객체 저장소 포트는 각각 33152·33153이었다. 종료 후 해당 project의 컨테이너·볼륨·네트워크는 각각 0개, 두 포트의 LISTEN은 0개, runner/Jest PID 48276·48341·48365는 모두 없었다. `/tmp/oss-hub-heavy.lock`도 없으며 정리 검사의 `CLEANUP_EXIT=0`을 확인했다. 작업 디렉터리를 사용하는 PID 43734는 `/opt/homebrew/bin/deno lsp`로 TCP LISTEN이 없는 에디터 도구여서 유지했다. 다른 worktree의 기존 Docker 자원은 건드리지 않았다. 별도 서버·브라우저·임시 파일은 만들지 않았다.
