'use client';

import { ProgramEditPage } from '@/features/programs/program-edit-page';
import { useSharedSessionRole } from '../../../_shell/session-role-context';

/**
 * `/programs/[id]/edit` 본문 — 게이트가 물려준 세션 역할로 「위험 영역」(영구 삭제,
 * #875) 노출 여부를 가른다. ADMIN만 그 섹션을 본다 — STAFF는 프로그램 생성자여도
 * 버튼조차 보이지 않는다(백엔드도 403으로 거절한다).
 */
export function ProgramEditRoute({
  programId,
}: {
  readonly programId: string;
}) {
  const { role } = useSharedSessionRole();
  return <ProgramEditPage programId={programId} isAdmin={role === 'ADMIN'} />;
}
