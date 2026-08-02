import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { ProgramCreationPage } from '@/features/programs/program-creation-page';

// #100 "프로그램 등록·관리"(URL: /staff/programs/new) — 접근: 승인된 STAFF, ADMIN.
export default function StaffProgramNewPage() {
  return (
    <RolePanelShell allow={['STAFF', 'ADMIN']}>
      <ProgramCreationPage />
    </RolePanelShell>
  );
}
