'use client';

import { ProgramStaffTeamsPage } from '@/features/programs/program-staff-teams-page';
import { ProgramTeamsPage } from '@/features/programs/program-teams-page';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

export function ProgramTeamsRouteView({
  programId,
}: {
  readonly programId: string;
}) {
  const { hasStaffAccess } = useSharedSessionRole();

  return hasStaffAccess ? (
    <ProgramStaffTeamsPage programId={programId} />
  ) : (
    <ProgramTeamsPage programId={programId} />
  );
}
