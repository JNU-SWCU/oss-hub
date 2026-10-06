'use client';

import { ProgramEditPage } from '@/features/programs/program-edit-page';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

export function ProgramEditRoute({
  programId,
}: {
  readonly programId: string;
}) {
  const { hasStaffAccess, hasAdminAccess } = useSharedSessionRole();
  return (
    <ProgramEditPage
      programId={programId}
      canDeleteProgram={hasStaffAccess || hasAdminAccess}
    />
  );
}
