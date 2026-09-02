import { redirect } from 'next/navigation';
import { programDocumentsHref } from '@/lib/program-route';

// 백엔드 URL 플립 전까지 유지하는 호환 redirect.
// #116 "제출 체크리스트와 보완 재제출"
// (URL: /programs/[id]/submissions, 선택 마일스톤: ?milestoneId={id}) —
// 접근: 승인된 application의 STUDENT(개인형 본인/팀형 팀원).
// checklistUrl이 아직 이 경로를 가리키므로 파일은 유지하고 /documents로 보낸다.
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
    redirect(programDocumentsHref(programId, rawMilestoneId));
  }
  redirect(programDocumentsHref(programId));
}
