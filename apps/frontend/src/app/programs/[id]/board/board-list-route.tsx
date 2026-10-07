'use client';

import { BoardListView } from '@/features/board/components/board-list-view';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

export function BoardListRoute({ programId }: { readonly programId: string }) {
  const { hasStaffAccess } = useSharedSessionRole();
  return <BoardListView programId={programId} isStaff={hasStaffAccess} />;
}
