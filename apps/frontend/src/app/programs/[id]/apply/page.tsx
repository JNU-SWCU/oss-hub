import { RoleGate } from '../../../_shell/role-gate';
import { decodeRouteProgramId } from '@/features/programs/program-paths';
import { ProgramApplyRoute } from './program-apply-route';

// #104 "프로그램 신청"(URL: /programs/[id]/apply) — 접근: 신청 기간 내 STUDENT.
// 프로그램 상세(#103)에서 진입하는 문맥적 경로라 좌측 패널 메뉴에는 넣지 않는다.
// 신청 화면은 프로그램 하나만 받는다. 임의의 팀을 고르는 teamId 질의는 없앴고(#1269),
// 알 수 없는 질의 문자열은 Next가 그대로 무시한다.
export default async function ProgramApplyRoutePage({
  params,
}: {
  readonly params: Promise<{ readonly id: string }>;
}) {
  const { id } = await params;

  return (
    <RoleGate allow={['student']}>
      <ProgramApplyRoute programId={decodeRouteProgramId(id)} />
    </RoleGate>
  );
}
