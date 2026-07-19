import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { STAFF_MENU } from '../../../_shell/role-menus';
import { TicketStub } from '../../../_shell/ticket-stub';

// #100 "프로그램 등록·관리"(URL: /staff/programs/new) — 접근: 승인된 STAFF, ADMIN.
export default function StaffProgramNewPage() {
  return (
    <RolePanelShell menu={STAFF_MENU} allow={['STAFF', 'ADMIN']}>
      <TicketStub ticketNumber={100} title="프로그램 등록·관리" />
    </RolePanelShell>
  );
}
