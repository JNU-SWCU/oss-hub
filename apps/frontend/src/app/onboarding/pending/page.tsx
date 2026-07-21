import { RoleRequestScreen } from '@/features/roles/components/role-request-screen';
import { OnboardingGate } from '../../_shell/onboarding-gate';

// #107 "교직원 승인 대기"(URL: /onboarding/pending) — 요청 없음은 역할 선택으로,
// PENDING/REJECTED/APPROVED는 요청 상태 화면으로, REVOKED는 역할 선택으로 분기한다.
export default function OnboardingPendingPage() {
  return (
    <OnboardingGate target="pending">
      <RoleRequestScreen />
    </OnboardingGate>
  );
}
