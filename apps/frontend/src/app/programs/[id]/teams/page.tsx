import { RoleGate } from '../../../_shell/role-gate';
import { ProgramTeamsPage } from '@/features/programs/program-teams-page';
import { decodeRouteProgramId } from '@/features/programs/program-paths';

// #105 "팀 구성"(URL: /programs/[id]/teams) — 접근: STUDENT.
// 팀형 프로그램에서 팀 생성·참여코드 합류·내 팀 확인 후 #104 신청으로 이어진다.
export default async function ProgramTeamsRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;

  return (
    <RoleGate allow={['STUDENT']}>
      <ProgramTeamsPage programId={decodeRouteProgramId(id)} />
    </RoleGate>
  );
}
