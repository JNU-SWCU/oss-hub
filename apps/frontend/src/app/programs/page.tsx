'use client';

import { ProgramListPage } from '@/features/programs/program-list-page';
import { useSessionRole } from '../_shell/use-session-role';

export default function ProgramsPage() {
  const session = useSessionRole();
  const canCreateProgram =
    session.status === 'assigned' &&
    session.isProfileComplete &&
    session.hasStaffAccess;
  const viewerRole =
    session.status !== 'assigned'
      ? null
      : session.hasStaffAccess
        ? 'STAFF'
        : session.memberKind === 'STUDENT'
          ? 'STUDENT'
          : null;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ProgramListPage
        canCreateProgram={canCreateProgram}
        viewerRole={viewerRole}
      />
    </main>
  );
}
