'use client';

import { BoardDetailScreen } from '@/features/board/components/board-detail-screen';
import { useSharedSessionRole } from '../../../../_shell/session-role-context';

export function BoardDetailRoute({
  programId,
  postId,
}: {
  readonly programId: string;
  readonly postId: string;
}) {
  const { hasStaffAccess } = useSharedSessionRole();
  return (
    <BoardDetailScreen
      programId={programId}
      postId={postId}
      isStaff={hasStaffAccess}
    />
  );
}
