import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ADMIN_MENU } from '../../_shell/role-menus';
import { TicketStub } from '../../_shell/ticket-stub';

// #108 "교직원 승인 관리"(URL: /admin/staff-requests) — 접근: ADMIN만.
export default function StaffRequestsPage() {
  return (
    <RolePanelShell menu={ADMIN_MENU} allow={['ADMIN']}>
      <TicketStub ticketNumber={108} title="교직원 승인 관리" />
    </RolePanelShell>
  );
}
