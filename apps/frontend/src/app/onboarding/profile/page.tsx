import { AuthGate } from '../../_shell/auth-gate';
import { OnboardingProgress } from '../../_shell/onboarding-progress';
import { ProfileOnboardingScreen } from '@/features/profile/components/profile-onboarding-screen';

// #153 온보딩 프로필 입력 — 로그인 후 현행 동의를 마친 사용자만 진행한다.
export default function OnboardingProfilePage() {
  return (
    <AuthGate>
      <OnboardingProgress current={2} />
      <ProfileOnboardingScreen />
    </AuthGate>
  );
}
