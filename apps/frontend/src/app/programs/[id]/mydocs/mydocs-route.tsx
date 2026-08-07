'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { PageBody } from '@/components/page-body';
import { SubmissionChecklistPage } from '@/features/submissions/submission-checklist-page';
import { programMyDocsHref } from '@/lib/program-route';

export function MyDocsRoute({ programId }: { readonly programId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedMilestoneId = searchParams.get('milestoneId');

  // 본문 여백은 화면이 각자 넣는 것이 이 저장소의 관례다(셸은 `min-w-0` 만 준다).
  // 「내 제출물」은 그 여백이 어디에도 없어 320·375px 에서 내용이 뷰포트 가장자리에
  // 붙었다(QA22). 여백을 `SubmissionChecklistPage` 안이 아니라 여기 두는 이유는 그
  // 화면이 `/programs/[id]` 상세의 슬롯으로도 쓰이고 거기는 이미 자기 여백이
  // 있어서다 — 안에 넣으면 그쪽이 이중 여백이 된다.
  return (
    <PageBody>
      <SubmissionChecklistPage
        programId={programId}
        milestoneId={selectedMilestoneId}
        onCloseSelected={() => {
          const next = new URLSearchParams(searchParams.toString());
          next.delete('milestoneId');
          const query = next.toString();
          router.replace(
            `${programMyDocsHref(programId)}${query ? `?${query}` : ''}`,
            { scroll: false },
          );
        }}
        onSelectMilestone={(milestoneId) => {
          router.push(programMyDocsHref(programId, milestoneId), {
            scroll: false,
          });
        }}
      />
    </PageBody>
  );
}
