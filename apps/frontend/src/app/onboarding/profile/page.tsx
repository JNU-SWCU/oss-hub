import { AuthGate } from '../../_shell/auth-gate';
import { OnboardingProgress } from '../../_shell/onboarding-progress';
import { ProfileOnboardingRoute } from './profile-onboarding-route';

// #153 온보딩 프로필 입력 — 약관·역할을 마친 사용자의 마지막 단계다. 역할이 이미
// 정해져 있어야 역할별 필수 항목(학생만 학번 등)을 정확히 물을 수 있다.
export default function OnboardingProfilePage() {
  return (
    <AuthGate>
      <OnboardingProgress current={3} />
      <ProfileOnboardingRoute />
    </AuthGate>
  );
}
