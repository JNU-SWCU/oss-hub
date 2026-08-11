import { OnboardingGate } from '../../_shell/onboarding-gate';
import { RoleRequestRoute } from './role-request-route';

// #107 "교직원 승인 대기"(URL: /onboarding/pending) — 요청 없음은 역할 선택으로,
// PENDING/REJECTED/APPROVED는 요청 상태 화면으로, REVOKED는 역할 선택으로 분기한다.
//
// 승인을 기다리는 사람은 여기 머무르므로, 자기 이름·학과를 고치러 갈 길도 이 화면이
// 함께 낸다(#598 — `RoleRequestStatusView`의 `PENDING_PROFILE_EDIT_PATH`). 그 길이
// 가리키는 설정 화면이 실제로 열려 있는지는 `profile-edit-path.test.ts`가 지킨다.
// 역할 선택 단계는 열지 않는다 — 승인 대기 중에 다시 고르면 요청이 하나 더 만들어져
// 관리자 승인 목록에 같은 사람이 두 번 뜬다. `OnboardingGate`의 그 가드는 그대로다.
export default function OnboardingPendingPage() {
  return (
    <OnboardingGate target="pending">
      <RoleRequestRoute />
    </OnboardingGate>
  );
}
