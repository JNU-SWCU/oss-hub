import { AuthGate } from '../../_shell/auth-gate';
import { TicketStub } from '../../_shell/ticket-stub';

// #107 "교직원 승인 대기"(URL: /onboarding/pending) — 역할 미선택과 PENDING을
// 같은 #107 스텁으로 수렴한다(플랜 합의 사항, /auth/me가 아직 PENDING을 구분해
// 노출하지 않음).
export default function OnboardingPendingPage() {
  return (
    <AuthGate>
      <TicketStub ticketNumber={107} title="교직원 승인 대기" />
    </AuthGate>
  );
}
