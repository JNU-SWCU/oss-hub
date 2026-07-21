import { AuthGate } from '../../_shell/auth-gate';
import { RoleSelectionScreen } from '@/features/roles/components/role-selection-screen';

// #107 "역할 선택"(URL: /onboarding/role) — 로그인 사용자만, 역할 확정 전 화면.
export default function OnboardingRolePage() {
  return (
    <AuthGate>
      <RoleSelectionScreen />
    </AuthGate>
  );
}
