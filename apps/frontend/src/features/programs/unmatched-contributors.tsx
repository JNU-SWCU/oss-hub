import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import type { StaffUnmatchedContributor } from './types';

/**
 * 「웹 참여자와 연결되지 않음」 — 저장소에 기여했지만 지금 팀원이 아닌 가입자(#1133).
 * 교직원이 팀에 합류하지 않은 기여자를 알아볼 수 있게 팀 활동 카드 안 접힘으로 둔다.
 * 수는 그래프의 Commit·PR·Issue에 옛 목록의 Release를 더해 부른다 — Release만 낸 사람이
 * 「0 · 0 · 0」으로 서지 않게.
 */
export function UnmatchedContributors({
  contributors,
}: {
  readonly contributors: readonly StaffUnmatchedContributor[];
}) {
  return (
    <Collapsible className="border-t border-border pt-2">
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="group w-full justify-between"
        >
          웹 참여자와 연결되지 않음 {contributors.length}명
          <ChevronDown
            aria-hidden="true"
            className="transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
          />
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="pt-2">
        {contributors.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            연결되지 않은 기여자가 없습니다.
          </p>
        ) : (
          <ul className="grid gap-1 text-sm">
            {contributors.map((contributor) => (
              <li
                key={contributor.githubId}
                className="flex flex-wrap justify-between gap-x-4"
              >
                <span className="break-all">
                  {contributor.githubLogin === null
                    ? `GitHub ID ${contributor.githubId}`
                    : `@${contributor.githubLogin}`}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  Commit {contributor.commitCount} · PR{' '}
                  {contributor.pullRequestCount} · Issue{' '}
                  {contributor.issueCount} · Release {contributor.releaseCount}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
