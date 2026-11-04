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
