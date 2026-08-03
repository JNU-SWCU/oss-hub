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
      {/* 이 화면만 본문 폭 제한을 푼다 — 넓은 화면에서 약관 전문이 동의 항목
          오른쪽에 나란히 펼쳐지기 때문이다(#517). 항목 기둥 자체는 `ConsentFlow`
          안에서 `max-w-2xl`로 남는다. 폭 값은 `CONSENT_POLICY_INLINE_BREAKPOINT_PX`와
          같아야 한다 — `consent-policy-breakpoint.test.ts`가 지킨다. */}
      <SignupStage step={1} contentClassName="min-[1280px]:max-w-none">
        <ConsentFlow />
      </SignupStage>
    </AuthGate>
  );
}
