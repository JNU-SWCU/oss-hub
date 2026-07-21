import { RoleSelectionScreen } from '@/features/roles/components/role-selection-screen';
import { OnboardingGate } from '../../_shell/onboarding-gate';

// #107 "역할 선택"(URL: /onboarding/role) — 로그인 사용자만, 역할 확정 전 화면.
export default function OnboardingRolePage() {
  return (
    <OnboardingGate target="role">
      <RoleSelectionScreen />
    </OnboardingGate>
  );
}
