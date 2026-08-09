'use client';

import { ProgramListPage } from '@/features/programs/program-list-page';
import { useSessionRole } from '../_shell/use-session-role';

export default function ProgramsPage() {
  const { role, status, isProfileComplete } = useSessionRole();
  const canCreateProgram =
    status === 'assigned' &&
    isProfileComplete &&
    (role === 'STAFF' || role === 'ADMIN');
  // 배정 전(unassigned)까지는 학생용 문구로 fallback — 부제 갈림은 STAFF/ADMIN만 본다.
  const viewerRole = status === 'assigned' ? role : null;

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ProgramListPage
        canCreateProgram={canCreateProgram}
        viewerRole={viewerRole}
      />
    </main>
  );
}
