import type { StaffOutsiderContributions } from './types';

export function OutsiderContributions({
  counts,
}: {
  readonly counts: StaffOutsiderContributions;
}) {
  const total =
    counts.commitCount + counts.pullRequestCount + counts.issueCount;
  return (
    <div className="border-t border-border pt-2">
      <p className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 px-4 text-small">
        <span className="font-medium">팀원이 아닌 사람의 기여</span>
        <span className="tabular-nums text-muted-foreground">
          {total === 0
            ? '없음'
            : `Commit ${counts.commitCount} · PR ${counts.pullRequestCount} · Issue ${counts.issueCount}`}
        </span>
      </p>
    </div>
  );
}
