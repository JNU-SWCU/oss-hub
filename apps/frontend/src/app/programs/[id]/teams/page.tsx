import { RoleGate } from '../../../_shell/role-gate';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramTeamsRouteView } from './program-teams-route-view';

// #105 "팀 구성"(URL: /programs/[id]/teams) — 접근: STUDENT, STAFF, ADMIN.
//
// STUDENT는 팀 생성·참여코드 합류·내 팀 확인 후 #104 신청으로 이어진다.
// STAFF·ADMIN은 참여 팀 목록(QA33)을 본다. 프로그램 사이드바가 역할과 무관하게
// "참여 팀"을 내보내고 팀 수 뱃지까지 붙이는데, 교직원이 누르면 학생 전용 게이트에
// 막혀 "접근 권한이 없는 페이지"가 뜨던 것을 이 확장이 받는다.
//
// 사이드바 href를 역할별로 가르지 않고 이 경로에서 갈라야 뱃지 숫자와 목록이
// 어긋나지 않는다 — 뱃지는 프로그램의 전체 팀 수를 세고, 교직원 목록도 같은 축이다.
export default async function ProgramTeamsRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;

  return (
    <RoleGate allow={['student', 'staff']}>
      <ProgramTeamsRouteView programId={decodeRouteProgramId(id)} />
    </RoleGate>
  );
}
