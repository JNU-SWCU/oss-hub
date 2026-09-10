'use client';

import type { ReactElement } from 'react';
import { useSession } from '@/features/auth/use-session';
import { ProgramApplyPage } from '@/features/programs/program-apply-page';

type ProgramApplyRouteProps = {
  readonly programId: string;
};

export function ProgramApplyRoute({
  programId,
}: ProgramApplyRouteProps): ReactElement {
  const session = useSession();
  if (session.status !== 'authenticated' || session.user === null) {
    throw new Error('RoleGate rendered the apply route without a session user');
  }

  return <ProgramApplyPage programId={programId} sessionUser={session.user} />;
}
