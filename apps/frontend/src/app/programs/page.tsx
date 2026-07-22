'use client';

import { ProgramListPage } from '@/features/programs/program-list-page';
import { useSessionRole } from '../_shell/use-session-role';

export default function ProgramsPage() {
  const { role, status } = useSessionRole();
  const canCreateProgram =
    status === 'assigned' && (role === 'STAFF' || role === 'ADMIN');

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <ProgramListPage canCreateProgram={canCreateProgram} />
    </main>
  );
}
