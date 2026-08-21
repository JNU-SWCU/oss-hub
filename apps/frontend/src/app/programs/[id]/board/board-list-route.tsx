'use client';

import { BoardListView } from '@/features/board/components/board-list-view';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

/**
 * `/programs/[id]/board` 본문 — 게이트가 물려준 세션 역할로 교직원 여부만 가른다.
 * 교직원(STAFF·ADMIN)은 공지를 쓰고, 학생은 질문을 쓴다(`board.service.ts createPost`).
 */
export function BoardListRoute({ programId }: { readonly programId: string }) {
  const { hasStaffAccess } = useSharedSessionRole();
  return <BoardListView programId={programId} isStaff={hasStaffAccess} />;
}
