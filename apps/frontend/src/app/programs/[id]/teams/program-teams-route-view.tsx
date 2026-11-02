'use client';

import { hasStaffAudience } from '../../../_shell/member-access';
import { ProgramStaffTeamsPage } from '@/features/programs/teams/program-staff-teams-page';
import { ProgramTeamsPage } from '@/features/programs/teams/program-teams-page';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

export function ProgramTeamsRouteView({
  programId,
}: {
  readonly programId: string;
}) {
  const session = useSharedSessionRole();

  return hasStaffAudience(session) ? (
    <ProgramStaffTeamsPage programId={programId} />
  ) : (
    <ProgramTeamsPage programId={programId} />
  );
}
