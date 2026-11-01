'use client';

import { BoardListScreen } from '@/features/board/components/board-list-screen';
import { hasStaffAudience } from '../../../_shell/member-access';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

export function BoardListRoute({ programId }: { readonly programId: string }) {
  const session = useSharedSessionRole();
  return (
    <BoardListScreen
      programId={programId}
      isStaff={hasStaffAudience(session)}
    />
  );
}
