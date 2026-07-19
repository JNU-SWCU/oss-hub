import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ADMIN_MENU } from '../../_shell/role-menus';
import { TicketStub } from '../../_shell/ticket-stub';

// #132 "감사 로그"(URL: /admin/audit-log) — 접근: ADMIN만.
export default function AdminAuditLogPage() {
  return (
    <RolePanelShell menu={ADMIN_MENU} allow={['ADMIN']}>
      <TicketStub ticketNumber={132} title="감사 로그" />
    </RolePanelShell>
  );
}
