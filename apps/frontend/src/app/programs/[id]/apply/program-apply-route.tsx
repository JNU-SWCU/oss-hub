'use client';

import { useSession } from '@/features/auth/use-session';
import { ProgramApplyPage } from '@/features/programs/program-apply-page';

export function ProgramApplyRoute({
  programId,
  teamId,
}: {
  readonly programId: string;
  readonly teamId: string | null;
}) {
  const session = useSession();
  if (session.status !== 'authenticated' || session.user === null) {
    throw new Error('RoleGate rendered the apply route without a session user');
  }

  return (
    <ProgramApplyPage
      programId={programId}
      sessionUser={session.user}
      teamId={teamId}
    />
  );
}
