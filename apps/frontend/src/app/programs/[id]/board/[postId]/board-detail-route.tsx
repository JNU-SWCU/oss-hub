'use client';

import { BoardDetailView } from '@/features/board/components/board-detail-view';
import { useSharedSessionRole } from '../../../../_shell/session-role-context';

/** `/programs/[id]/board/[postId]` 본문 — `board-list-route.tsx`와 동일한 역할 판정. */
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
