'use client';

import { BoardDetailScreen } from '@/features/board/components/board-detail-screen';
import { hasStaffAudience } from '../../../../_shell/member-access';
import { useSharedSessionRole } from '../../../../_shell/session-role-context';

export function BoardDetailRoute({
  programId,
  postId,
}: {
  readonly programId: string;
  readonly postId: string;
}) {
  const session = useSharedSessionRole();
  return (
    <BoardDetailScreen
      programId={programId}
      postId={postId}
      isStaff={hasStaffAudience(session)}
    />
  );
}
