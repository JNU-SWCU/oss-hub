import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatRelativeTime } from '../system-status-format';
import type { CollectionRepository } from '../types';

const VISIBLE_REPOSITORIES = 5;
const REPOSITORY_ROW = cn(
  'grid gap-x-4 gap-y-1 py-2 [&+&]:border-t [&+&]:border-border/50',
  'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
);

export function StaleRepositoryList({
  repositories,
}: {
  readonly repositories: readonly CollectionRepository[];
}) {
  const listId = useId();
  const [expanded, setExpanded] = useState(false);
  const now = new Date();
  const mostDelayedFirst = [...repositories].sort((left, right) =>
    (left.lastSuccessAt ?? '').localeCompare(right.lastSuccessAt ?? ''),
  );
  const foldedCount = mostDelayedFirst.length - VISIBLE_REPOSITORIES;
  const visible = expanded
    ? mostDelayedFirst
    : mostDelayedFirst.slice(0, VISIBLE_REPOSITORIES);

  return (
    <div className="grid gap-2">
      <ul id={listId} className="grid">
        {visible.map((repository) => {
          const owner = [repository.teamName, repository.programName]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={repository.repositoryName} className={REPOSITORY_ROW}>
              <p className="font-semibold [overflow-wrap:anywhere]">
                {repository.repositoryName}
                {owner ? (
                  <>
                    {' '}
                    <span className="inline-block font-normal text-muted-foreground">
                      {owner}
                    </span>
                  </>
                ) : null}
              </p>
              {repository.lastSuccessAt ? (
                <p className="text-small text-muted-foreground tabular-nums">
                  마지막 수집 성공{' '}
                  <time dateTime={repository.lastSuccessAt}>
                    {formatRelativeTime(repository.lastSuccessAt, now)}
                  </time>
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      {foldedCount > 0 ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="justify-self-start"
          aria-expanded={expanded}
          aria-controls={listId}
          onClick={() => setExpanded((open) => !open)}
        >
          {expanded
            ? '지연 저장소 접기'
            : `지연 저장소 ${foldedCount}개 더 보기`}
        </Button>
      ) : null}
    </div>
  );
}
