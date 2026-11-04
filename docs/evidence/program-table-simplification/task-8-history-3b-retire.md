# Todo 8 3b 데이터 이관 draft

이 draft는 코드 선행 PR #1738이 운영되고 구 writer가 모두 종료된 뒤에만 적용한다. 지금 main/v0.24.44에 먼저 적용하지 않는다. migration의 선행 head는 `20261104150000_prepare_invitation_archival`이다. 물리 컬럼·테이블 DROP은 포함하지 않는다.

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

`git fetch origin main` 후 `origin/main`의 `f5c6b8b99529af00fe7e81d12e5cdf1da72af589`에 rebase했다. main의 마지막 디렉터리는 `20261104140000_prepare_team_history`이므로 `20261104160000_retire_terminal_invitations`는 이미 마지막 순서이며 이름을 바꾸지 않았다. 작업 시작 SQL SHA-256은 `83601e25b2ebc887aedae3a5fa47ed12c8a610b6cb0c4b4c5baee73ebce61097`이었다. SQL 변경은 승인 가드와 그 검사를 위한 잠금·빈 DB 판정에 한정한다.

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
