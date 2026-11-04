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
- 새 초대 종료는 이력 기록·가입·outbox와 삭제를 한 트랜잭션에 둔다.
- Preparation DB reader·consumer를 제거하고 새 프론트도 fallback API를 호출하지 않는다. 구 프론트의 보호 GET에는 DB 조회 없는 NONE 응답만 유지한다.
- 데이터 이관까지 PENDING status 필터를 유지한다. 기존 종료 행의 이관·삭제 및 status 읽기 중단은 별도 draft PR이다.
- 이관 전 팀 삭제가 기존 종료 행을 잃지 않도록 INVITATION_ARCHIVED에 원본 status/respondedAt/updatedAt을 보존한다. 이는 실제 보관 사건이며 과거 취소·거절 행위자를 추정하지 않는다. 기존 이력이 있으면 덮어쓰지 않는다.
- 이 코드의 migration은 Preparation 0건 검사, 이후 INSERT를 막는 두 CHECK(false), archive enum 추가다. 기존 행의 이동·삭제와 물리 DROP은 하지 않는다.
- 게이트 수정: 0건 확인과 같은 트랜잭션에서 Preparation 두 테이블에 `CHECK (false)`를 추가한다. 이후 INSERT는 명시적으로 실패하여 reader를 제거한 불변식을 유지한다. trigger나 배포 파이프라인 변경은 없다. v0.24.44 미만으로 rollback하면 Preparation 생성이 실패할 수 있다. v0.24.44 이상은 새 Preparation을 만들지 않는다. 초대 이력 활동 판정 때문에 요구되는 별도 rollback 하한은 그대로다.

v0.24.44는 삭제된 초대를 활동으로 셀 수 없어 초대만 있던 사용자의 등록 초기화 보호를 잃는다. 따라서 삭제를 시작한 뒤의 rollback 하한은 이 코드 선행 릴리스다. 데이터 draft가 이 선행 앱과 호환되는지 별도로 검증하며 v0.24.44로 직접 image rollback이 안전하다고 주장하지 않는다.

## 현재 확인된 증거

기존 의미를 깨는 red는 4 failed / 35 passed였고, 팀 삭제의 legacy 종료 행 손실 red는 1 failed / 21 passed였다.

코드 변경 뒤 타깃 DB 10 suites / 193 tests가 통과했다. 변경한 HTTP·DTO 검증은 113 tests / 101 snapshots가 통과했고 프론트 reader 관련 3 files / 75 tests가 통과했다. 폐기한 Preparation 계약의 테스트는 제거하고 빈 상태 migration 거부·보호 GET·폐기 경로 404·정상 신청/초대 검증으로 대체했다. 관련 없는 DTO 사례는 그대로 유지했다.

v0.24.44의 실제 hasActivity 원문(blob `0ccf563b3d968f42106621018fe87999943aae7c`)을 독립 fixture에 넣어 같은 DB에서 비교했다. 삭제 후 새 코드는 ROL_025로 거부하지만 구 판정은 false이며 같은 등록 초기화 서비스가 실제로 type을 UNSELECTED, studentId를 null로 바꾼다. 행위자·초대 대상·초대자만 이력에 남은 경우도 비교했다. 타깃 10 tests, backend/frontend typecheck, knip와 파일 원장이 EXIT=0으로 통과했다.

코드 단계 manifest는 `deploy/jenkins/program-migration/team-history/code.json`이며 선행 migration은 prepare_team_history다. 두 CHECK(false)의 늦은 INSERT 거부를 포함한 타깃 5개가 통과했다. 가이드에 TIV_010 재시도 안내도 추가했다.

별도 draft #1741의 서버 내부 리허설에서 이 코드 migration과 이관 SQL을 순서대로 적용했다. Preparation 제약 2개, 이력 INSERT 25, ACCEPTED DELETE 20·DECLINED DELETE 5, 초대 28→3, 대기 3·팀 40·구성원 72를 확인했다. 재실행 추가 이동은 0이고 백업 복원 건수도 동일했다. tmpfs/--rm 임시 컨테이너·dump·소스 디렉터리 잔여 0, 최종 EXIT=0이다. 상세 영수증은 draft의 `task-8-history-3b-retire.md`에 둔다.

merge·release·물리 DROP은 수행하지 않았다. main의 별도 테스트 복구 PR #1740에서 전체 unit을 한 번 실행한 결과는 390 suites / 6,327 tests이며 이 코드 브랜치 전체 스위트 결과로 혼동하지 않는다. pre-push의 raw pnpm이 환경 옵션을 무시해 예상 밖 auto-install/postinstall을 실행한 이력이 있어, 후속 호출은 PATH의 로컬 wrapper로 `--config.verify-deps-before-run=false`를 명시 전달했다. lockfile 변경은 없다.

## 폐기 계약의 게이트 회귀 수정

인가 목록·보호 경로 건수·삭제 범위 SQL 테스트에서 3 failed / 17 passed를 직접 재현했다. 제거된 9개 경로만 기대 목록에서 빼고 보호 경로 120개, 전체 경로 137개를 유지한다. 실제 컨트롤러 탐색·익명 요청 거부·전체 목록 대조는 그대로다. 삭제 범위 쿼리는 폐기 테이블 두 개를 읽지 않음을 검증하며 나머지 범위와 바인딩 값 검증을 유지한다. 수정 후 타깃 3 suites / 20 tests와 backend typecheck가 통과했다.

purge의 폐기된 신청 준비 fixture 3개는 현재 계약으로 바꿨다. 준비가 없는 프로그램 삭제가 다른 프로그램·계정을 보존하고, 삭제 확인 이후 준비 또는 참여자의 INSERT는 각각 이름 있는 CHECK에 거부되며 원래 확인 범위로 삭제가 성공한다. 실제 자식 행 추가를 다루는 기존 댓글·게시글 경합, 권한과 원자성 검증은 유지한다. 테스트 skip·only나 제약 완화는 없다.
