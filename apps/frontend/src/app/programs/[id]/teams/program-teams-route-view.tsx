'use client';

import { useSharedSessionRole } from '../../../_shell/session-role-context';
import { ProgramStaffTeamsPage } from '@/features/programs/program-staff-teams-page';
import { ProgramTeamsPage } from '@/features/programs/program-teams-page';

/**
 * `/programs/[id]/teams`의 역할 분기.
 *
 * 게이트가 이미 읽은 스냅샷을 `useSharedSessionRole`로 물려받는다 — 여기서
 * `useSessionRole()`을 다시 부르면 역할 조회가 한 번 더 나가고, 게이트가 판단한
 * 순간과 다른 답을 볼 수 있다(#676이 지적하는 그 구조).
 *
 * `RoleGate`를 두 번 겹쳐 쓰지 않는 이유는 그것이 불일치를 **빈 화면이 아니라 접근
 * 거부 안내**로 그리기 때문이다 — 두 번 쓰면 한쪽은 반드시 "접근 권한이 없는
 * 페이지"를 그린다.
 */
export function ProgramTeamsRouteView({
  programId,
}: {
  readonly programId: string;
}) {
  const { role } = useSharedSessionRole();

  return role === 'STAFF' || role === 'ADMIN' ? (
    <ProgramStaffTeamsPage programId={programId} />
  ) : (
    <ProgramTeamsPage programId={programId} />
  );
}
