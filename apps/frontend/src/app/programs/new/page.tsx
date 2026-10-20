import { RolePanelShell } from '../../_shell/role-panel-shell';
import { ProgramCreationPage } from "@/features/programs/authoring/program-creation-page";

export default function ProgramNewPage() {
  return (
    <RolePanelShell allow={['staff']}>
      <ProgramCreationPage />
    </RolePanelShell>
  );
}
