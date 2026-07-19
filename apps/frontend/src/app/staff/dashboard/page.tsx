import { RolePanelShell } from '../../_shell/role-panel-shell';
import { STAFF_MENU } from '../../_shell/role-menus';
import { TicketStub } from '../../_shell/ticket-stub';

// #117 "운영 대시보드"(URL: /staff/dashboard) — 접근: APPROVED STAFF, ADMIN.
export default function StaffDashboardPage() {
  return (
    <RolePanelShell menu={STAFF_MENU} allow={['STAFF', 'ADMIN']}>
      <TicketStub ticketNumber={117} title="운영 대시보드" />
    </RolePanelShell>
  );
}
