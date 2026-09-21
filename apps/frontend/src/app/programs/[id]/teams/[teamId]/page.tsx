'use client';

import { use } from 'react';
import { RolePanelShell } from '../../../../_shell/role-panel-shell';
import { useSession } from '@/features/auth/use-session';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramStaffTeamDetailPage } from '@/features/programs/program-staff-team-detail-page';

/**
 * 세션은 여기서만 읽는다 — `features/programs`는 `features/auth`를 직접 import할 수
 * 없다(feature 간 직접 의존 금지, `eslint.config.mjs`). 「우리 팀」 라우트가
 * `sessionUser`를 내려 주는 것과 같은 방식이다.
 *
 * 팀 구성을 고치는 요청이 진행 중일 때 다른 사람으로 로그인이 바뀌면 그 결과를
 * 새 사용자 화면에 흘리면 안 된다. 화면은 그 판정에 이 값을 쓴다.
 */
function ProgramStaffTeamDetailWorkspace({
  programId,
  teamId,
}: {
  readonly programId: string;
  readonly teamId: string;
}) {
  const session = useSession();
  const sessionKey =
    session.status === 'authenticated'
      ? (session.user?.nickname ?? null)
      : null;

  return (
    <ProgramStaffTeamDetailPage
      programId={programId}
      teamId={teamId}
      sessionKey={sessionKey}
    />
  );
}

// 교직원 전용 팀 상세(URL: /programs/[id]/teams/[teamId], #874) — 접근: STAFF, ADMIN.
// 참여 팀 목록(`/programs/[id]/teams`)의 팀명에서 들어가는 문맥 경로이며 좌측
// 패널 메뉴에는 넣지 않는다(같은 디렉터리의 `milestones/[milestoneId]/documents`와
// 같은 원칙).
export default function ProgramStaffTeamDetailRoute({
  params,
}: {
  readonly params: Promise<{ readonly id: string; readonly teamId: string }>;
}) {
  const { id, teamId } = use(params);
  // seed id·teamId에는 `:`가 들어가 링크가 인코딩해 보낸다 — 두 값 모두 되돌려
  // 놓아야 조회 경로가 다시 인코딩할 때 이중 인코딩이 되지 않는다.
  return (
    <RolePanelShell allow={['staff']}>
      <ProgramStaffTeamDetailWorkspace
        programId={decodeRouteProgramId(id)}
        teamId={decodeRouteProgramId(teamId)}
      />
    </RolePanelShell>
  );
}
