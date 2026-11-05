# Todo 8 다음 릴리스의 물리 삭제 draft

선행 코드 PR은 #1746, head 4efd5689cd8f946e35696bd168ecfe8f929763fe다. 이 앱이 실제 배포된 뒤 그 다음 릴리스에서만 이 draft를 적용한다. migration이 앱 교체보다 먼저 실행되므로 A와 B를 같은 릴리스로 묶지 않는다. 이 작업은 merge·release 발행·배포·운영 DB 쓰기를 하지 않는다.

## 읽기 전용 preflight

2026-11-05 운영에서 committed preflight.sql을 BEGIN READ ONLY로 실행했다. EXIT=0이다. migration head는 20261104190000_retire_terminal_invitations다.

| 항목 | 정확한 건수 |
| --- | ---: |
| 초대 전체 / PENDING | 3 / 3 |
| 종료 초대 / 응답시각 비NULL | 0 / 0 |
| ApplicationPreparation / participant | 0 / 0 |
| TeamHistory | 25 |
| 중복 teamId·inviteeId 그룹 | 0 |
| 준비 두 테이블의 컬럼 / 인덱스 / 제약 | 12 / 7 / 8 |
| status enum 라벨 | 4 |

검증된 TeamInvitation_pending_only CHECK도 존재한다. A가 아직 배포되지 않은 현재 단계에서 이 수치는 삭제 실행 허가가 아니라 draft의 정확한 예상 값이다. 실제 배포 직전 같은 preflight를 다시 읽어야 한다. 대기 초대 수는 정상 사용으로 바뀔 수 있으며 migration은 그 수를 임의의 상수로 고정하지 않고 NOTICE로 실제 집계를 남긴다. 준비 행·종료 행·응답시각이 하나라도 남으면 중단한다.

## 정확한 비가역 삭제

- TeamInvitation.status: 컬럼 1개, 현재 PENDING 값 3개.
- TeamInvitation.respondedAt: 컬럼 1개, 현재 비NULL 값 0개.
- TeamInvitation_pending_only CHECK 1개와 기존 status 종속 인덱스 2개. 새 전체 UNIQUE(teamId, inviteeId)와 inviteeId 인덱스 2개로 교체한다.
- ApplicationPreparationParticipant와 ApplicationPreparation: 테이블 2개, 행 각각 0개. 그 안의 컬럼 12개·인덱스 7개·제약 8개도 함께 사라진다.
- TeamInvitationStatus enum 1개, PENDING·ACCEPTED·DECLINED·EXPIRED 라벨 4개.

초대 3행과 그 나머지 값, TeamHistory 25행은 보존한다. DELETE 문·백필·새 이력 생성은 없다. 예상 행 삭제는 0이다. 실제 운영에서 실행한 삭제 역시 0이다.

## migration 불변식

한 트랜잭션에서 세 대상 테이블을 ACCESS EXCLUSIVE로 잠근 뒤 집계·가드·DROP·인덱스 교체를 수행한다. 준비 두 테이블이 비어 있고 초대는 PENDING뿐이며 respondedAt이 전부 NULL이고 선행 CHECK가 검증됐어야 진행한다. 예상하지 않은 FK·타입 의존성이 있으면 CASCADE로 우회하지 않고 실패하여 전체를 롤백한다. 실패 후 보관 값·타입·테이블이 그대로인 것을 fixture로 확인한다. 복구는 소유자 계약대로 사전 백업 복원이며 구 이미지 호환 경로는 없다.

## 검증과 리허설 범위

새 fixture는 물리 삭제 후 초대의 나머지 전체 JSON과 과거 이력 JSON 보존, 전체 UNIQUE의 실제 중복 거부, status 없는 새 INSERT, 준비 두 테이블 각각 비어 있지 않을 때 중단, 세 종료 상태 각각 중단, 응답시각 중단, 선행 CHECK 부재 중단, 빈 DB를 검사한다.

가드를 FALSE로 바꾼 최초 변이는 준비 두 fixture에서 예상한 거부 대신 성공했다. 초기 9개 중 3 failed / 6 passed, EXIT=1이며 나머지 한 실패는 raw 유니크 오류의 메시지에 인덱스명이 없어서 생긴 테스트 오류였다. PostgreSQL 23505를 Prisma P2010/meta.code로 검증하도록 수정했다. 가드 SQL은 바이트 단위로 복원했다. 복원 SHA-256은 558009e147fcf7e4abf718b331491c7780f1cbacb1ada762d7bcfdba0675a3d2다.

운영 서버 내부 컨테이너 리허설은 실행하지 않았다. 이 migration은 기존 행을 이동하거나 삭제하지 않고 빈 두 테이블과 컬럼만 제거하므로, 소유자가 지정한 예외에 따라 운영 read-only preflight와 로컬 빈 DB·가드·앱 경로 검증을 실행했다. 서버 리허설 컨테이너·덤프·익명 볼륨 생성은 모두 0, 잔여도 각각 0이다. 운영 백업·최종 배포는 release 담당 단계다.

앱 코드·화면·Prisma datamodel은 A와 동일하다. 따라서 제품 파일 원장 수치와 A의 Chrome 캡처·guide는 그대로 유지한다. 전체 suite는 실행하지 않고 CI 및 독립 gate를 merge 전 관문으로 남긴다.

복원 후 실제 PostgreSQL 검증은 새 migration 9개와 A의 지원·초대·팀 삭제·초기화 경로를 합쳐 13 suites / 228 tests, EXIT=0이다. 최초 빈 DB에서 B까지 전체 migration을 적용했고, B가 이미 적용된 스키마에서 A 앱의 create·accept·decline·cancel과 경합·이력 원자성도 통과했다.

정적 관문도 backend typecheck·lint, lint:structure, format:check, check:file-ledger 모두 EXIT=0이다. 기존 boundaries 폐기 예정 경고와 원장의 module-type 안내만 남았다. 직전 fetch의 origin/main 마지막 migration은 20261104190000_retire_terminal_invitations였으며 새 20261105030000_retire_invitation_status_and_preparations가 뒤에 정렬된다. push 직전 다시 비교한다. 앱 코드·제출 파일 수정은 0건이다.
