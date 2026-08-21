import { RoleGate } from '../../../_shell/role-gate';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { BoardListRoute } from './board-list-route';

// "게시판"(URL: /programs/[id]/board) — 접근: 프로그램 참여자(STUDENT)와 교직원(STAFF·ADMIN).
// 좌측 패널 프로그램 스코프 3그룹 중 "게시판" 그룹에서 진입한다(sidebar-menu.ts boardGroup).
export default async function ProgramBoardRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;

  return (
    <RoleGate allow={['student', 'staff']}>
      <BoardListRoute programId={decodeRouteProgramId(id)} />
    </RoleGate>
  );
}
