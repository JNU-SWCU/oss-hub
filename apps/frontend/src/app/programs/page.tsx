'use client';

import { ProgramListPage } from '@/features/programs/program-list-page';
import { useSessionRole } from '../_shell/use-session-role';

export default function ProgramsPage() {
  const { role, status } = useSessionRole();
  const canCreateProgram =
    status === 'assigned' && (role === 'STAFF' || role === 'ADMIN');

  return (
    <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {status === 'loading' ? (
        <div aria-label="프로그램 목록을 불러오는 중" className="min-h-48" />
      ) : (
        <ProgramListPage
          canCreateProgram={canCreateProgram}
          includeViewer={status === 'assigned' && role === 'STUDENT'}
        />
      )}
    </main>
  );
}
