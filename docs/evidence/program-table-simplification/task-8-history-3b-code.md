# Todo 8 3b 코드 선행

기준 main은 `b07f89d16db6f2015cd791e03676eb9d829e28cb`다. 소유자가 v0.24.44 운영을 확인한 뒤 시작했다.

## 읽기 전용 집계

2026-11-04, EXIT=0. migration head는 prepare_team_history이고 미완료 migration은 0이다.

| 항목 | 건수 |
| --- | ---: |
| Preparation / participant | 0 / 0 |
| 대기 / 수락 / 거절 초대 | 3 / 20 / 5 |
| 종료 초대 | 25 |
| 종료 초대 중 이미 이력에 있는 행 | 0 |
| TeamHistory 전체 | 0 |
| 팀 / 구성원 | 40 / 72 |

종료 시각 누락, 팀 누락, 대기 초대의 응답 시각·이력 존재, 중복 대기 그룹은 모두 0이다. 운영 DB에는 쓰지 않았다.

## 코드 선행 경계

- 등록 초기화는 TeamHistory의 actorId와 초대 대상·초대자를 활동으로 확인한다.
- 새 초대 종료는 기존 terminal status와 respondedAt 갱신·이력 기록·가입·outbox를 한 트랜잭션에 둔다. 종료 행은 이번 릴리스에 보존한다.
- Preparation DB reader·consumer를 제거하고 새 프론트도 fallback API를 호출하지 않는다. 구 프론트의 보호 GET에는 DB 조회 없는 NONE 응답만 유지한다.
- 데이터 이관까지 PENDING status 필터를 유지한다. 기존 종료 행의 이관·삭제 및 status 읽기 중단은 별도 draft PR이다.
- 이관 전 팀 삭제가 기존 종료 행을 잃지 않도록 INVITATION_ARCHIVED에 원본 status/respondedAt/updatedAt을 보존한다. 이는 실제 보관 사건이며 과거 취소·거절 행위자를 추정하지 않는다. 기존 이력이 있으면 덮어쓰지 않는다.
- 이 코드의 migration은 Preparation 0건 검사, 이후 INSERT를 막는 두 CHECK(false), archive enum 추가다. 기존 행의 이동·삭제와 물리 DROP은 하지 않는다.
- 게이트 수정: 0건 확인과 같은 트랜잭션에서 Preparation 두 테이블에 `CHECK (false)`를 추가한다. 이후 INSERT는 명시적으로 실패하여 reader를 제거한 불변식을 유지한다. trigger나 배포 파이프라인 변경은 없다. v0.24.44 미만으로 rollback하면 Preparation 생성이 실패할 수 있다. v0.24.44 이상은 새 Preparation을 만들지 않는다.

v0.24.44는 TeamHistory를 읽지 않는다. 따라서 이번 릴리스는 기존 초대 행과 이력을 함께 보존하며 읽기만 확대한다. 이 이미지가 먼저 배포되어 이전 이미지도 TeamHistory를 이해하게 된 뒤, 후속 릴리스에서 종료 행의 물리 삭제와 데이터 이관을 진행한다. Jenkins의 이미지 rollback은 migration을 되돌리지 않으므로 이 순서가 필요하다.

## 현재 확인된 증거

기존 의미를 깨는 red는 4 failed / 35 passed였고, 팀 삭제의 legacy 종료 행 손실 red는 1 failed / 21 passed였다.

코드 변경 뒤 타깃 DB 10 suites / 193 tests가 통과했다. 변경한 HTTP·DTO 검증은 113 tests / 101 snapshots가 통과했고 프론트 reader 관련 3 files / 75 tests가 통과했다. 폐기한 Preparation 계약의 테스트는 제거하고 빈 상태 migration 거부·보호 GET·폐기 경로 404·정상 신청/초대 검증으로 대체했다. 관련 없는 DTO 사례는 그대로 유지했다.

v0.24.44의 실제 hasActivity 원문(blob `0ccf563b3d968f42106621018fe87999943aae7c`)을 독립 fixture에 넣어 같은 DB에서 비교했다. 과거 삭제 후보는 새 코드만 ROL_025로 거부하고 구 코드는 초기화를 허용하여 gate에서 거절됐다. 해당 성공 characterization은 실제 초대 거절 후 행을 보존하고 구 판정도 true, 구 서비스도 ROL_025를 반환하며 프로필이 유지되는 rollback 회귀로 교체했다. 수동 초대 삭제는 없다. 이력만 남은 행위자·초대 대상·초대자 보호 테스트는 유지한다. 아래 전체 실행 결과는 수정 이전 HEAD의 기록이며 이번 변경의 타깃 결과와 구분한다.

코드 단계 manifest는 `deploy/jenkins/program-migration/team-history/code.json`이며 선행 migration은 prepare_team_history다. 두 CHECK(false)의 늦은 INSERT 거부를 포함한 타깃 5개가 통과했다. 가이드에 TIV_010 재시도 안내도 추가했다.

별도 draft #1741의 서버 내부 리허설에서 이 코드 migration과 이관 SQL을 순서대로 적용했다. Preparation 제약 2개, 이력 INSERT 25, ACCEPTED DELETE 20·DECLINED DELETE 5, 초대 28→3, 대기 3·팀 40·구성원 72를 확인했다. 재실행 추가 이동은 0이고 백업 복원 건수도 동일했다. tmpfs/--rm 임시 컨테이너·dump·소스 디렉터리 잔여 0, 최종 EXIT=0이다. 상세 영수증은 draft의 `task-8-history-3b-retire.md`에 둔다.

merge·release·물리 DROP은 수행하지 않았다. main의 별도 테스트 복구 PR #1740에서 전체 unit을 한 번 실행한 결과는 390 suites / 6,327 tests이며 이 코드 브랜치 전체 스위트 결과로 혼동하지 않는다. pre-push의 raw pnpm이 환경 옵션을 무시해 예상 밖 auto-install/postinstall을 실행한 이력이 있어, 후속 호출은 PATH의 로컬 wrapper로 `--config.verify-deps-before-run=false`를 명시 전달했다. lockfile 변경은 없다.

## 폐기 계약의 게이트 회귀 수정

인가 목록·보호 경로 건수·삭제 범위 SQL 테스트에서 3 failed / 17 passed를 직접 재현했다. 제거된 9개 경로만 기대 목록에서 빼고 보호 경로 120개, 전체 경로 137개를 유지한다. 실제 컨트롤러 탐색·익명 요청 거부·전체 목록 대조는 그대로다. 삭제 범위 쿼리는 폐기 테이블 두 개를 읽지 않음을 검증하며 나머지 범위와 바인딩 값 검증을 유지한다. 수정 후 타깃 3 suites / 20 tests와 backend typecheck가 통과했다.

purge의 폐기된 신청 준비 fixture 3개는 현재 계약으로 바꿨다. 준비가 없는 프로그램 삭제가 다른 프로그램·계정을 보존하고, 삭제 확인 이후 준비 또는 참여자의 INSERT는 각각 이름 있는 CHECK에 거부되며 원래 확인 범위로 삭제가 성공한다. 실제 자식 행 추가를 다루는 기존 댓글·게시글 경합, 권한과 원자성 검증은 유지한다. 테스트 skip·only나 제약 완화는 없다.

## main 반영 후 전체 backend 검증

2026-11-04, 지정 worktree에서 `git fetch origin main` 후 `git rebase origin/main`을 실행했다. main `f5c6b8b99529af00fe7e81d12e5cdf1da72af589`이 이미 포함되어 충돌과 추가 코드 변경은 없었다. 검증한 HEAD는 `1dd1820d87153251597b0f22411f9c093e8050bb`이며 `submissions.repository.ts`는 main과 동일하다.

모든 테스트 명령은 `/tmp/oss-hub-heavy.lock`의 mkdir 획득과 rmdir 반환으로 직렬화했다. `pnpm --config.verify-deps-before-run=false`를 사용했고 통합 하네스의 내부 pnpm에도 `npm_config_verify_deps_before_run=false`를 전달했다. install은 실행하지 않았다.

| 전체 실행 | 명령 | 결과 |
| --- | --- | --- |
| backend unit | `pnpm --config.verify-deps-before-run=false --filter backend test:unit --maxWorkers=2` | 389 suites / 6,321 tests / 302 snapshots, EXIT=0 |
| backend integration | `pnpm --config.verify-deps-before-run=false --filter backend test:integration` | 150 suites / 1,169 tests, EXIT=0 |

통합 하네스는 Jest `--runInBand`를 사용했다. `program-purge.integration.spec.ts`를 포함한 전체 suite가 통과했다. 실패가 없어 origin/main 별도 checkout 비교는 필요하지 않았다. 기존 수정 커밋의 인가 목록, 120개 보호 경로, Preparation 없는 삭제 범위 검증과 purge fixture 3개를 그대로 검증했다.

초기 대기 중 만료된 watcher는 테스트를 시작하지 못했다. 실행 중인 테스트가 없는 고아 공유 lock을 확인하고 디렉터리만 해제한 뒤 백그라운드 세션에서 실행했다. 두 테스트 세션은 EXIT=0으로 종료했고 통합 하네스의 Docker 정리도 EXIT=0이다. dev server, 임시 checkout, 임시 파일은 만들지 않았다.

## IS-7 / 계약 15 rollback 차단 수정

2026-11-04 독립 gate가 `b63b8ff7b`를 REJECT했다. 배포 뒤 새 초대만 받았다가 거절한 사용자는 다른 활동이 없을 수 있다. 이때 종료 행을 삭제하면 TeamHistory를 모르는 이전 이미지로 rollback한 뒤 등록 초기화가 잘못 허용된다. 현재 운영 노출 0건은 이후 생성될 초대의 안전성을 보장하지 않는다.

네 종료 경로의 `where`, terminal status, `respondedAt`을 origin/main과 동일한 `updateMany`로 복원했다. 수락은 ACCEPTED, 팀장 취소·수신자 거절·다른 팀 합류에 따른 자동 종료는 기존대로 DECLINED다. TeamHistory의 실제 취소 사건과 자동 종료 사유 기록은 유지한다. 현재 HEAD에 이미 있던 TeamHistory 활동 조회와 기존 송수신 초대 행 조회는 모두 유지했다.

삭제를 전제한 테스트는 terminal status·응답 시각과 이력의 공존을 확인한다. 중복 수락의 두 번째 결과는 `not-pending`이며, 대기 목록에서 종료 행을 숨기는 기존 필터도 검증한다. 팀 자체의 물리 삭제 이후 이력이 남는 테스트는 FK 자식인 보존 초대도 정리한다. rollback 테스트에는 수동 초대 삭제가 없다.

`image rollback preserves legacy activity detection and refuses registration reset after invitation decline`은 초대 전 활동 false, 초대 후 true, 실제 거절 후 구 판정 true, 구 서비스의 ROL_025 거부, 기존 학생 프로필·승인·세션 유지까지 확인한다. 이는 구 판정이 false이고 초기화가 성공하던 characterization을 대체한다.

모든 검증은 다음 공유 잠금 아래 한 번에 하나씩 실행했다.

```bash
until mkdir /tmp/oss-hub-heavy.lock 2>/dev/null; do sleep 5; done
<command>
rc=$?
rmdir /tmp/oss-hub-heavy.lock
(exit $rc)
```

pnpm은 모두 `--config.verify-deps-before-run=false`를 전달했다. 통합 하네스의 내부 pnpm에도 같은 플래그를 넣는 임시 PATH wrapper를 사용했다. 하네스의 Jest `--runInBand`만 `--maxWorkers=2`로 교체했고 대상 패턴은 유지했다. 의존성 설치와 전체 suite는 실행하지 않았다.

| 실행 | 명령 | 결과 |
| --- | --- | --- |
| 단위 대상 | `pnpm --config.verify-deps-before-run=false --filter backend exec jest --maxWorkers=2 --runTestsByPath src/programs/team-invitations.repository.acceptance.spec.ts src/programs/team-invitations.repository.create-search.spec.ts src/programs/team-invitations.service.respond.spec.ts src/users/member-registration-reset.repository.spec.ts src/users/member-registration-reset.service.spec.ts src/users/member-registration-reset.http.spec.ts` | 6 suites / 109 tests, EXIT=0 |
| 첫 통합 대상 | `BACKEND_INTEGRATION_TEST_PATTERN='(team-invitations[^/]*\|member-registration-reset)\.integration\.spec\.ts$' pnpm --config.verify-deps-before-run=false --filter backend test:integration` | 2 failed / 4 passed suites, 7 failed / 50 passed tests, EXIT=1. 남은 삭제 기대값과 물리 팀 삭제 fixture를 수정했다. |
| 수정 후 같은 통합 대상 | 위와 같은 명령 | 6 suites / 57 tests, EXIT=0 |
| 활동 판정 변이 | `BACKEND_INTEGRATION_TEST_PATTERN='member-registration-reset\.integration\.spec\.ts$' pnpm --config.verify-deps-before-run=false --filter backend test:integration` | 4 failed / 6 passed tests, EXIT=1. 새 rollback 테스트도 Expected true / Received false로 실패했다. |
| 변이 원복 | 바로 위와 같은 명령 | 1 suite / 10 tests, EXIT=0 |
| backend lint | `pnpm --config.verify-deps-before-run=false --filter backend lint` | EXIT=0. 기존 boundaries 설정의 mode deprecation warning은 남아 있다. |
| backend typecheck | `pnpm --config.verify-deps-before-run=false --filter backend typecheck` | EXIT=0 |
| format | `pnpm --config.verify-deps-before-run=false exec prettier --check .` | 첫 실행 EXIT=1의 세 테스트 파일 줄바꿈을 수정한 뒤 EXIT=0 |

변이는 `member-registration-reset.repository.ts`의 `if (history) return true;`를 `if (history) return false;`로 반전했다. 이력만 있는 세 역할 테스트와 새 rollback 테스트가 실패했다. 단순히 이력 조회를 제거하는 변이는 보존 초대 행을 읽어 rollback 테스트가 통과해야 하므로, 이력 판정 결과를 잘못 반환하는 변이를 사용했다. 변이 전 SHA-256은 `1559610dd977c297dfc74781332a22250ab9a15b85732edd3bde46e33f29d221`, 변이 후는 `b4cad70083e919b6f196c7bb54060f944f9a1c47726ae25b28b9931a52712180`이다. 원복 후 문자열 전체와 SHA-256이 변이 전과 일치함을 확인했다.

복원한 네 `updateMany` 구문 전체를 origin/main과 대조하여 네 곳 모두 정확히 일치함을 확인했다. `member-registration-reset.repository.ts`는 기존 읽기 확대를 보존하므로 최종 diff가 없다. 새 migration이나 배포 스크립트 변경도 없다. 전체 gate·merge·release는 소유자가 별도로 수행한다.

정리 영수증: 네 통합 실행의 하네스가 각 임시 compose 프로젝트와 볼륨을 반환했다. 이후 Docker 컨테이너·볼륨 목록은 시작 전부터 있던 다른 작업의 각 2개와 동일하며 이 작업 소유 잔여는 0개다. 임시 pnpm wrapper와 디렉터리를 제거했다. Next·Nest 서버와 브라우저는 시작하지 않았다. pnpm-lock.yaml 변경은 없다.
