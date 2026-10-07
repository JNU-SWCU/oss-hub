'use client';

import { use } from 'react';
import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { useSession } from '@/features/auth/use-session';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramStaffTeamDetailPage } from '@/features/programs/program-staff-team-detail-page';

function ProgramStaffTeamDetailWorkspace({
  programId,
  teamId,
}: {
  readonly programId: string;
  readonly teamId: string;
}) {
  const session = useSession();
  const sessionKey =
    session.status === 'authenticated'
      ? (session.user?.nickname ?? null)
      : null;

  return (
    <ProgramStaffTeamDetailPage
      programId={programId}
      teamId={teamId}
      sessionKey={sessionKey}
    />
  );
}

export default function ProgramStaffTeamDetailRoute({
  params,
}: {
  readonly params: Promise<{ readonly id: string; readonly teamId: string }>;
}) {
  const { id, teamId } = use(params);

  return (
    <RolePanelShell allow={['staff']}>
      <ProgramStaffTeamDetailWorkspace
        programId={decodeRouteProgramId(id)}
        teamId={decodeRouteProgramId(teamId)}
      />
    </RolePanelShell>
  );
}
