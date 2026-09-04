'use client';

import { ProgramEditPage } from '@/features/programs/program-edit-page';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

/**
 * `/programs/[id]/edit` 본문 — 게이트가 물려준 세션 역할로 「위험 영역」(영구 삭제)
 * 노출 여부를 가른다.
 *
 * #1095로 삭제 권한이 교직원 전권이 되면서, 이 화면을 쓰는 교직원이 자기 화면에서
 * 삭제까지 한다. 관리자 접근만 가진 사용자도 이 화면에 닿는다면 종전과 같이 그 섹션을
 * 본다 — 넓히기만 하고 좁히지 않는다. 백엔드도 같은 판정(교직원 또는 관리자)이다.
 */
export function ProgramEditRoute({
  programId,
}: {
  readonly programId: string;
}) {
  const { hasStaffAccess, hasAdminAccess } = useSharedSessionRole();
  return (
    <ProgramEditPage
      programId={programId}
      canDeleteProgram={hasStaffAccess || hasAdminAccess}
    />
  );
}
