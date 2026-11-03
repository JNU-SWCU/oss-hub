'use client';

import { ProgramEditPage } from '@/features/programs/authoring/program-edit-page';
import { useSharedSessionRole } from '../../../_shell/session-role-context';
import { hasStaffAudience } from '../../../_shell/member-access';

export function ProgramEditRoute({
  programId,
}: {
  readonly programId: string;
}) {
  const session = useSharedSessionRole();
  return (
    <ProgramEditPage
      programId={programId}
      canDeleteProgram={hasStaffAudience(session)}
    />
  );
}
