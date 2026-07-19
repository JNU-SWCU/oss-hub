import { RoleGate } from '../../../../../../_shell/role-gate';
import { TicketStub } from '../../../../../../_shell/ticket-stub';

// #125 "제출물 검토"
// (URL: /staff/programs/[id]/submissions/[submissionId]/review) —
// 접근: APPROVED STAFF, ADMIN. 문맥적 경로라 좌측 패널 메뉴에는 넣지 않는다.
export default function SubmissionReviewPage() {
  return (
    <RoleGate allow={['STAFF', 'ADMIN']}>
      <TicketStub ticketNumber={125} title="제출물 검토" />
    </RoleGate>
  );
}
