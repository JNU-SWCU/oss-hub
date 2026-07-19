import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ADMIN_MENU } from '../../_shell/role-menus';
import { TicketStub } from '../../_shell/ticket-stub';

// #133 "시스템 상태"(URL: /admin/system-status) — 접근: ADMIN만.
export default function AdminSystemStatusPage() {
  return (
    <RolePanelShell menu={ADMIN_MENU} allow={['ADMIN']}>
      <TicketStub ticketNumber={133} title="시스템 상태" />
    </RolePanelShell>
  );
}
