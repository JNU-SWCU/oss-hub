'use client';

import { useContext } from 'react';
import { ProgramViewContext } from '../../../_shell/program-shell-policy';
import { ProgramStaffTeamsPage } from "@/features/programs/teams/program-staff-teams-page";
import { ProgramTeamsPage } from "@/features/programs/teams/program-teams-page";
import { useSharedSessionRole } from '../../../_shell/session-role-context';

export function ProgramTeamsRouteView({
  programId,
}: {
  readonly programId: string;
}) {
  const { hasStaffAccess } = useSharedSessionRole();

  const programView = useContext(ProgramViewContext);
  const operationsView =
    programView === null
      ? hasStaffAccess
      : programView === 'STAFF' || programView === 'ADMIN';
  return operationsView ? (
    <ProgramStaffTeamsPage programId={programId} />
  ) : (
    <ProgramTeamsPage programId={programId} />
  );
}
