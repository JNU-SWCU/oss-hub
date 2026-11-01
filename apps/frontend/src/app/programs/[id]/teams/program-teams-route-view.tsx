'use client';

import { useContext } from 'react';
import {
  ProgramViewContext,
  resolveProgramOperationsView,
} from '../../../_shell/program-shell-policy';
import { ProgramStaffTeamsPage } from '@/features/programs/teams/program-staff-teams-page';
import { ProgramTeamsPage } from '@/features/programs/teams/program-teams-page';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

export function ProgramTeamsRouteView({
  programId,
}: {
  readonly programId: string;
}) {
  const session = useSharedSessionRole();

  const programView = useContext(ProgramViewContext);
  const operationsView = resolveProgramOperationsView(programView, session);
  if (operationsView === null) return null;
  return operationsView ? (
    <ProgramStaffTeamsPage programId={programId} />
  ) : (
    <ProgramTeamsPage programId={programId} />
  );
}
