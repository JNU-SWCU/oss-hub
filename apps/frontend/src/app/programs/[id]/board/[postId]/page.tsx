import { RoleGate } from '../../../../_shell/role-gate';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { BoardDetailRoute } from './board-detail-route';

// "게시글 상세"(URL: /programs/[id]/board/[postId]) — 접근은 목록과 동일.
export default async function ProgramBoardDetailRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string; readonly postId: string }>;
}) {
  const { id, postId } = await params;

  return (
    <RoleGate allow={['student', 'staff']}>
      <BoardDetailRoute
        programId={decodeRouteProgramId(id)}
        postId={decodeURIComponent(postId)}
      />
    </RoleGate>
  );
}
