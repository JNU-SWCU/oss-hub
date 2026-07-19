import { RoleGate } from '../../../_shell/role-gate';
import { TicketStub } from '../../../_shell/ticket-stub';

// #104 "프로그램 신청"(URL: /programs/[id]/apply) — 접근: 신청 기간 내 STUDENT.
// 프로그램 상세(#103)에서 진입하는 문맥적 경로라 좌측 패널 메뉴에는 넣지 않는다.
export default function ProgramApplyPage() {
  return (
    <RoleGate allow={['STUDENT']}>
      <TicketStub ticketNumber={104} title="프로그램 신청" />
    </RoleGate>
  );
}
