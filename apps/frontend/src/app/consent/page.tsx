import { AuthGate } from '../_shell/auth-gate';
import { SignupStage } from '../_shell/signup-stage';
import { ConsentFlow } from '@/features/consents/components/consent-flow';

// #99 "개인정보·활동 동의"(URL: /consent) — 로그인 사용자만, 역할 무관.
//
// 무대를 여기서 두른다. `SignupStage`는 app 계층에 있고 feature는 app을 import할 수
// 없으므로(app → features 단방향), 화면을 조립하는 일은 페이지의 몫이다.
// 진행 표시(`OnboardingProgress`)도 무대가 안에서 부르므로 여기서 따로 부르지 않는다 —
// 예전에는 페이지가 직접 불러 놓고 그 위를 모달이 덮어 버렸다.
export default function ConsentPage() {
  return (
    <AuthGate>
      <SignupStage step={1}>
        <ConsentFlow />
      </SignupStage>
    </AuthGate>
  );
}
