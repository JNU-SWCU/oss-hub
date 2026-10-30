'use client';

import { useContext } from 'react';
import { useSession } from '@/features/auth/use-session';
import {
  ProgramDetailPage,
  type ProgramDetailSession,
} from '@/features/programs/catalog/program-detail-page';
import { ProgramViewContext } from '../../_shell/program-shell-policy';
import { renderSignInApplyEntry } from './sign-in-apply-entry';

export function ProgramDetailScreen({
  programId,
}: {
  readonly programId: string;
}) {
  const programView = useContext(ProgramViewContext);
  const { status: sessionStatus } = useSession();

  const session: ProgramDetailSession =
    sessionStatus === 'loading'
      ? 'unknown'
      : sessionStatus === 'anonymous'
        ? 'anonymous'
        : 'present';

  return (
    <ProgramDetailPage
      programId={programId}
      session={session}
      renderSignInApply={renderSignInApplyEntry}
      operationsView={
        programView === null
          ? undefined
          : programView === 'STAFF' || programView === 'ADMIN'
      }
    />
  );
}
