import { RoleGate } from '../../../_shell/role-gate';
import { ProgramApplyPage } from '@/features/programs/program-apply-page';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

// #104 "프로그램 신청"(URL: /programs/[id]/apply) — 접근: 신청 기간 내 STUDENT.
// 프로그램 상세(#103)에서 진입하는 문맥적 경로라 좌측 패널 메뉴에는 넣지 않는다.
export default async function ProgramApplyRoutePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string }>;
  readonly searchParams?: Promise<
    Record<string, string | string[] | undefined>
  >;
}) {
  const { id } = await params;
  const resolvedSearchParams = await searchParams;
  const rawTeamId = resolvedSearchParams?.teamId;
  const teamId =
    typeof rawTeamId === 'string' && rawTeamId.length > 0 ? rawTeamId : null;

  return (
    <RoleGate allow={['STUDENT']}>
      <ProgramApplyPage programId={decodeRouteProgramId(id)} teamId={teamId} />
    </RoleGate>
  );
}
