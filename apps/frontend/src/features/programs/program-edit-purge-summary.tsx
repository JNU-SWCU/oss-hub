import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import type { ProgramDeletionScopeCounts } from './api';

export function ProgramPurgeSummary({
  counts,
}: {
  readonly counts: ProgramDeletionScopeCounts;
}) {
  const items = [
    ['지원서', counts.applications, '건'],
    ['팀', counts.teams, '개'],
    ['게시글', counts.boardPosts, '건'],
    ['제출물', counts.submissions, '건'],
    ['제출·검토·파일 이력', counts.submissionEvents, '건'],
  ] as const;
  const summary = items
    .filter(([, count]) => count > 0)
    .map(([label, count, unit]) => `${label} ${count}${unit}`)
    .join(' · ');
  return (
    <Alert>
      <AlertTitle>삭제될 데이터</AlertTitle>
      <AlertDescription>
        {summary ? `삭제될 데이터: ${summary}` : '연결된 데이터 없음'}
      </AlertDescription>
    </Alert>
  );
}
