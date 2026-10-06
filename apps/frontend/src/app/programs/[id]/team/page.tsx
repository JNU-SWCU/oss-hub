'use client';

import { use, useMemo } from 'react';
import { RolePanelShell } from '../../../_shell/role-panel-shell';
import { useSession } from '@/features/auth/use-session';
import { ProgramMyTeamPage } from '@/features/programs/program-my-team-page';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { SubmissionChecklistPage } from '@/features/submissions/submission-checklist-page';

function ProgramMyTeamWorkspace({ programId }: { readonly programId: string }) {
  const session = useSession();
  const user = session.status === 'authenticated' ? session.user : null;
  const sessionUser = useMemo(
    () => (user === null ? null : { nickname: user.nickname, name: user.name }),
    [user],
  );

  return (
    <ProgramMyTeamPage
      programId={programId}
      sessionUser={sessionUser}

      submissionContent={
        <SubmissionChecklistPage programId={programId} milestoneId={null} />
      }
    />
  );
}

export default function ProgramMyTeamRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = use(params);
  return (
    <RolePanelShell allow={['student']}>
      <ProgramMyTeamWorkspace programId={decodeRouteProgramId(id)} />
    </RolePanelShell>
  );
}
