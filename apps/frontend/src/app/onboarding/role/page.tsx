import { RoleSelectionScreen } from '@/features/roles/components/role-selection-screen';
import { OnboardingGate } from '../../_shell/onboarding-gate';
import { SignupStage } from '../../_shell/signup-stage';

// #107 "역할 선택"(URL: /onboarding/role) — 로그인 사용자만, 역할 확정 전 화면.
//
// 아직 회원이 아닌 사람이 보는 화면이라 가입 무대(어두운 우주 바탕) 위에 선다 —
// 프로필까지 마쳐야 회원이고, 그때 순백 업무 화면으로 넘어간다(`_shell/signup-routes`).
// 무대는 app 계층에 있고 화면은 feature에 있으므로(features는 app을 import할 수 없다)
// 둘을 만나게 하는 자리가 이 페이지다.
//
// 진행 표시를 여기서 부르지 않는다. 예전에는 `OnboardingProgress current={2}`를 본문
// 위에 가로로 얹었는데, 이제 무대가 왼쪽 세로 눈금으로 품고 있어 `step`만 넘기면 된다 —
// 둘 다 부르면 같은 눈금이 두 번 그려진다.
export default function OnboardingRolePage() {
  return (
    <OnboardingGate target="role">
      <SignupStage step={2}>
        <RoleSelectionScreen />
      </SignupStage>
    </OnboardingGate>
  );
}
