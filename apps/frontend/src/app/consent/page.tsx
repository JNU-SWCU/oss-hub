import { AuthGate } from '../_shell/auth-gate';
import { ConsentFlow } from '@/features/consents/components/consent-flow';

// #99 "개인정보·활동 동의"(URL: /consent) — 로그인 사용자만, 역할 무관.
export default function ConsentPage() {
  return (
    <AuthGate>
      <ConsentFlow />
    </AuthGate>
  );
}
