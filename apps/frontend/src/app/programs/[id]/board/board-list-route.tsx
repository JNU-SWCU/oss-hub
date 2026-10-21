'use client';

import { BoardListScreen } from '@/features/board/components/board-list-screen';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

export function BoardListRoute({ programId }: { readonly programId: string }) {
  const { hasStaffAccess } = useSharedSessionRole();
  return <BoardListScreen programId={programId} isStaff={hasStaffAccess} />;
}
