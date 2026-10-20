'use client';

import { useContext, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useSession } from '@/features/auth/use-session';
import {
  ProgramDetailPage,
  type ProgramDetailSession,
} from '@/features/programs/program-detail-page';
import { programDocumentsHref } from '@/lib/program-route';
import { ProgramViewContext } from '../../_shell/program-shell-policy';

export function ProgramDetailScreen({
  programId,
}: {
  readonly programId: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const programView = useContext(ProgramViewContext);
  const legacyMilestoneId = searchParams.get('submission');
  const { status: sessionStatus } = useSession();

  const session: ProgramDetailSession =
    sessionStatus === 'loading'
      ? 'unknown'
      : sessionStatus === 'anonymous'
        ? 'anonymous'
        : 'present';

  useEffect(() => {
    if (legacyMilestoneId === null) return;
    router.replace(programDocumentsHref(programId, legacyMilestoneId));
  }, [legacyMilestoneId, programId, router]);

  return (
    <ProgramDetailPage
      programId={programId}
      session={session}
      operationsView={
        programView === null
          ? undefined
          : programView === 'STAFF' || programView === 'ADMIN'
      }
    />
  );
}
