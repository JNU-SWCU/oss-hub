import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ProgramCreationPage } from '@/features/programs/program-creation-page';

// 프로그램 등록(URL: /programs/new) — 접근: 승인된 STAFF, ADMIN.
// programId가 없으므로 섹션 스코프(`programs`) 사이드바를 쓴다.
export default function ProgramNewPage() {
  return (
    <RolePanelShell allow={['staff']}>
      <ProgramCreationPage />
    </RolePanelShell>
  );
}
