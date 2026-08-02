import { AuthGate } from '../../_shell/auth-gate';
import { SignupStage } from '../../_shell/signup-stage';
import { ProfileOnboardingRoute } from './profile-onboarding-route';

// #153 온보딩 프로필 입력 — 약관·역할을 마친 사용자의 마지막 단계다. 역할이 이미
// 정해져 있어야 역할별 필수 항목(학생만 학번 등)을 정확히 물을 수 있다.
//
// 무대(진행 눈금 포함)를 화면이 아니라 페이지가 두른다 — `features`는 `app`을
// import할 수 없어(app → features → lib 단방향) 화면 쪽에서 무대를 부를 방법이
// 없다. 조립은 app의 일이라는 뜻이기도 하다.
export default function OnboardingProfilePage() {
  return (
    <AuthGate>
      <SignupStage step={3}>
        <ProfileOnboardingRoute />
      </SignupStage>
    </AuthGate>
  );
}
