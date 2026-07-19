import { RoleGate } from '../../../../../_shell/role-gate';
import { TicketStub } from '../../../../../_shell/ticket-stub';

// #115 "마일스톤 제출"(URL: /programs/[id]/milestones/[milestoneId]/submit) —
// 접근: 승인된 application의 STUDENT(개인형 본인/팀형 팀원). 문맥적 경로라
// 좌측 패널 메뉴에는 넣지 않는다.
export default function MilestoneSubmitPage() {
  return (
    <RoleGate allow={['STUDENT']}>
      <TicketStub ticketNumber={115} title="마일스톤 제출" />
    </RoleGate>
  );
}
