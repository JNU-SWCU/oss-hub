import type { StaffOutsiderContributions } from './types';

/**
 * 「팀원이 아닌 사람의 기여」(#1133) — 팀 저장소에 올라온 기여 가운데 지금 팀원이 아닌 사람의 몫을
 * 사람 목록 없이 수로만 보인다. 교직원이 팀 밖 기여가 있는지 알아보는 신호이고, 누구인지는
 * GitHub에서 직접 본다. 수는 그래프와 같은 Commit·PR·Issue로 부르고, 옆 「저장소 URL 변경 이력」
 * 줄과 같은 들여쓰기·높이에 선다.
 */
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
