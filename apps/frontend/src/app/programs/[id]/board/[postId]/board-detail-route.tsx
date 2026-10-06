'use client';

import { BoardDetailView } from '@/features/board/components/board-detail-view';
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
    <BoardDetailView
      programId={programId}
      postId={postId}
      isStaff={hasStaffAccess}
    />
  );
}
