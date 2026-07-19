import { AuthGate } from '../../_shell/auth-gate';
import { TicketStub } from '../../_shell/ticket-stub';

// #107 "역할 선택"(URL: /onboarding/role) — 로그인 사용자만, 역할 확정 전 화면.
export default function OnboardingRolePage() {
  return (
    <AuthGate>
      <TicketStub ticketNumber={107} title="역할 선택" />
    </AuthGate>
  );
}
