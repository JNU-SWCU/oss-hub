'use client';

import { useCallback, useContext } from 'react';

import { useSession } from '@/features/auth/use-session';
import {
  ProgramDetailPage,
  type ProgramDetailSession,
} from '@/features/programs/catalog/program-detail-page';
import { useReportProgramName } from '../../_shell/program-name-report-context';

import { ProgramViewContext } from '../../_shell/program-shell-policy';
import { renderSignInApplyEntry } from './sign-in-apply-entry';

export function ProgramDetailScreen({
  programId,
}: {
  readonly programId: string;
}) {
  const programView = useContext(ProgramViewContext);
  const { status: sessionStatus } = useSession();
  const reportProgramName = useReportProgramName();
  const onProgramName = useCallback(
    (name: string) => reportProgramName(programId, name),
    [reportProgramName, programId],
  );

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
      onProgramName={onProgramName}
      operationsView={
        programView === null
          ? null
          : programView === 'STAFF' || programView === 'ADMIN'
      }
    />
  );
}
