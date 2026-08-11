import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramStaffTeamDetailPage } from '@/features/programs/program-staff-team-detail-page';

// 교직원 전용 팀 상세(URL: /programs/[id]/teams/[teamId], #874) — 접근: STAFF, ADMIN.
// 참여 팀 목록(`/programs/[id]/teams`)의 팀명에서 들어가는 문맥 경로이며 좌측
// 패널 메뉴에는 넣지 않는다(같은 디렉터리의 `milestones/[milestoneId]/documents`와
// 같은 원칙).
export default async function ProgramStaffTeamDetailRoute({
  params,
}: {
  readonly params: Promise<{ readonly id: string; readonly teamId: string }>;
}) {
  const { id, teamId } = await params;
  // seed id·teamId에는 `:`가 들어가 링크가 인코딩해 보낸다 — 두 값 모두 되돌려
  // 놓아야 조회 경로가 다시 인코딩할 때 이중 인코딩이 되지 않는다.
  return (
    <RolePanelShell allow={['STAFF', 'ADMIN']}>
      <ProgramStaffTeamDetailPage
        programId={decodeRouteProgramId(id)}
        teamId={decodeRouteProgramId(teamId)}
      />
    </RolePanelShell>
  );
}
