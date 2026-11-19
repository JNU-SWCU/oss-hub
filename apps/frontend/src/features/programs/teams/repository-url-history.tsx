'use client';

import { ChevronRight } from 'lucide-react';
import { useEffect, useState } from 'react';
import { FailureState } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { Skeleton, SkeletonBlock } from '@/components/ui/skeleton';
import { formatSeoulDate } from '../catalog/program-detail-format';
import { useRepositoryHistoryQuery } from './queries';

const HISTORY_DAY = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
  year: 'numeric',
  month: 'long',
  day: 'numeric',
});

export function repositoryNameFromUrl(url: string): string {
  return url.replace(/^https:\/\/github\.com\/|\/$/g, '');
}

interface RepositoryHistoryScope {
  readonly programId: string;
  readonly teamId: string;
}

export function RepositoryUrlHistoryDisclosure({
  initialCount,
  ...scope
}: RepositoryHistoryScope & { readonly initialCount?: number | null }) {
  const [requested, setRequested] = useState(false);
  const [loadedCount, setLoadedCount] = useState<number | null>(null);
  const count = initialCount ?? loadedCount;

  return (
    <Collapsible
      className="min-w-0 border-t border-border pt-3"
      onOpenChange={(open) => {
        if (open) setRequested(true);
      }}
    >
      <CollapsibleTrigger asChild>
        <Button
          type="button"
          variant="link"
          size="content"
          className="group flex gap-2 text-small text-muted-foreground"
        >
          <ChevronRight
            aria-hidden="true"
            className="transition-transform group-data-[state=open]:rotate-90 motion-reduce:transition-none"
          />
          {count === null ? '변경 이력' : `변경 이력 ${count}건`}
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent
        className="pt-2 data-[state=closed]:hidden"
        forceMount
      >
        {requested ? (
          <RepositoryUrlHistory {...scope} onCountChange={setLoadedCount} />
        ) : null}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function RepositoryUrlHistory({
  programId,
  teamId,
  onCountChange,
}: RepositoryHistoryScope & {
  readonly onCountChange?: (count: number | null) => void;
}) {
  const query = useRepositoryHistoryQuery(programId, teamId);
  const items = query.data?.pages.flatMap((page) => page.items);
  const count = !query.hasNextPage && items !== undefined ? items.length : null;
  useEffect(() => {
    onCountChange?.(count);
  }, [count, onCountChange]);
  const busy = query.isFetchingNextPage;

  if (query.isError && items === undefined) {
    return (
      <FailureState
        title="저장소 URL 변경 이력을 불러오지 못했습니다"
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (items === undefined) {
    return (
      <Skeleton label="저장소 URL 변경 이력 불러오는 중">
        <SkeletonBlock className="h-12 rounded-control" />
      </Skeleton>
    );
  }
  return (
    <section
      className="grid min-w-0 gap-3 break-keep [overflow-wrap:anywhere]"
      aria-label="저장소 URL 변경 이력"
    >
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          저장소 URL 변경 이력이 없습니다.
        </p>
      ) : (
        <ol className="grid gap-2 border-l border-border pl-4">
          {items.map((item) => (
            <li key={item.id} className="text-small">
              <time
                className="whitespace-nowrap text-muted-foreground"
                dateTime={item.occurredAt}
                title={formatSeoulDate(item.occurredAt)}
              >
                {HISTORY_DAY.format(new Date(item.occurredAt))}
              </time>
              {' · '}
              <span className="text-muted-foreground">
                @{item.actorGithubLogin}
              </span>
              {' · '}
              <span className="text-muted-foreground">
                {item.previousRepositoryUrl === null
                  ? '없음'
                  : repositoryNameFromUrl(item.previousRepositoryUrl)}
              </span>
              {' → '}
              {repositoryNameFromUrl(item.newRepositoryUrl)}
            </li>
          ))}
        </ol>
      )}
      {query.isFetchNextPageError ? (
        <Alert variant="destructive">
          <AlertTitle>이력 조회 실패</AlertTitle>
          <AlertDescription>
            표시된 이력은 유지되었습니다. 다시 시도하세요.
          </AlertDescription>
        </Alert>
      ) : null}
      {query.hasNextPage ? (
        <div className="flex justify-end">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void query.fetchNextPage()}
          >
            {busy ? '불러오는 중…' : '변경 이력 더 보기'}
          </Button>
        </div>
      ) : null}
    </section>
  );
}
