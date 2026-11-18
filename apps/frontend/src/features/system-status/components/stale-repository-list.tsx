import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { STALE_REPOSITORY_PAGE_SIZE } from '../api';
import { formatRelativeTime } from '../system-status-format';
import type { StaleRepositoryPage, StaleRepositoryPager } from '../types';

const REPOSITORY_ROW = cn(
  'grid gap-x-4 gap-y-1 py-2 [&+&]:border-t [&+&]:border-border/50',
  'sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center',
);

export function StaleRepositoryList({
  repositories,
  pager,
}: {
  readonly repositories: StaleRepositoryPage;
  readonly pager: StaleRepositoryPager;
}) {
  const now = new Date();
  const totalPages = Math.max(
    1,
    Math.ceil(repositories.total / STALE_REPOSITORY_PAGE_SIZE),
  );

  return (
    <div className="grid gap-2">
      <ul className="grid">
        {repositories.items.map((repository) => {
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
      {totalPages > 1 ? (
        <div className="flex items-center justify-end gap-3 text-sm">
          <span className="tabular-nums">
            {pager.page} / {totalPages} 페이지
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pager.page <= 1 || pager.isLoading}
            onClick={() => pager.onPageChange(pager.page - 1)}
          >
            이전
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pager.page >= totalPages || pager.isLoading}
            onClick={() => pager.onPageChange(pager.page + 1)}
          >
            다음
          </Button>
        </div>
      ) : null}
    </div>
  );
}
