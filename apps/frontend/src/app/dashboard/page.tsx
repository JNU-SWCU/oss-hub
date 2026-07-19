import { RolePanelShell } from '../_shell/role-panel-shell';
import { STUDENT_MENU } from '../_shell/role-menus';
import { TicketStub } from '../_shell/ticket-stub';

// #114 "내 대시보드"(URL: /dashboard) — 접근: STUDENT. APPROVED STAFF/ADMIN은
// 자기 역할 홈(/staff/dashboard)으로, 역할 미확정은 #107로 RoleGate가 되돌린다.
export default function DashboardPage() {
  return (
    <RolePanelShell menu={STUDENT_MENU} allow={['STUDENT']}>
      <TicketStub ticketNumber={114} title="내 대시보드" />
    </RolePanelShell>
  );
}
