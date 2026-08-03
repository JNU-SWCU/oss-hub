import { redirect } from 'next/navigation';
import { studentProgramSubmissionHref } from '@/lib/program-route';

// #116 "제출 체크리스트와 보완 재제출"
// (URL: /programs/[id]/submissions, 선택 마일스톤: ?milestoneId={id}) —
// 접근: 승인된 application의 STUDENT(개인형 본인/팀형 팀원). 문맥적 경로라
// 좌측 패널 메뉴에는 넣지 않는다.
export default async function ProgramSubmissionsPage({
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
  const rawMilestoneId = resolvedSearchParams?.milestoneId;
  const programId = decodeURIComponent(id);
  if (typeof rawMilestoneId === 'string') {
    redirect(studentProgramSubmissionHref(programId, rawMilestoneId));
  }
  redirect(`/programs/${encodeURIComponent(programId)}#milestones`);
}
