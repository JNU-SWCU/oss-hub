import { Fragment } from 'react';
import {
  EmptyState,
  ListPanel,
  ListRow,
  SectionHeading,
  StatusBadge,
} from '@/components';
import {
  COLLECTION_RUN_STATUS_BADGE,
  COLLECTION_RUN_STATUS_LABEL,
  type CollectionRunStatusKey,
} from '@/lib/status-vocabulary';
import { formatRelativeTime } from '../format-relative-time';
import type { CollectionActivityEntry } from '../types';

function scopeLabel(scope: string): string | null {
  if (scope === 'external') return '외부';
  if (scope.startsWith('org:')) return '조직';
  return null;
}

function ScopeBadge({ scope }: { readonly scope: string }) {
  const label = scopeLabel(scope);
  return (
    <StatusBadge variant="closed">
      {label ?? <code className="font-mono text-xs">{scope}</code>}
    </StatusBadge>
  );
}

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function MetricCounts({
  counts,
}: {
  readonly counts: readonly (readonly [label: string, count: number])[];
}) {
  return counts.map(([label, count], index) => (
    <Fragment key={label}>
      <span className="whitespace-nowrap">
        {label} {count}
        {index < counts.length - 1 ? ' ·' : ''}
      </span>
      {index < counts.length - 1 ? ' ' : ''}
    </Fragment>
  ));
}

function CountsSummary({ entry }: { readonly entry: CollectionActivityEntry }) {
  const total =
    entry.insertedCommitCount +
    entry.insertedPullRequestCount +
    entry.insertedReleaseCount +
    entry.insertedIssueCount;
  if (total === 0) {
    return (
      <span className="text-sm text-muted-foreground">신규 데이터 없음</span>
    );
  }
  return (
    <span className="text-sm">
      <MetricCounts
        counts={[
          ['Commit', entry.insertedCommitCount],
          ['PR', entry.insertedPullRequestCount],
          ['Release', entry.insertedReleaseCount],
          ['Issue', entry.insertedIssueCount],
        ]}
      />
    </span>
  );
}

function RepositoryProgress({
  entry,
}: {
  readonly entry: CollectionActivityEntry;
}) {
  return (
    <span className="flex items-center gap-2 text-xs text-muted-foreground">
      <span>
        저장소 {entry.processedRepositoryCount}/{entry.attemptedRepositoryCount}
      </span>
      {entry.failedRepositoryCount > 0 ? (
        <span className="font-semibold text-destructive">
          실패 {entry.failedRepositoryCount}
        </span>
      ) : null}
    </span>
  );
}

function runStatus(entry: CollectionActivityEntry): CollectionRunStatusKey {
  if (entry.kind === 'REPOSITORY_LINK' && !entry.stoppedForBudget) {
    return entry.failedRepositoryCount > 0 ? 'LINK_FAILED' : 'LINK_COLLECTED';
  }
  if (entry.cycleCompleted) return 'CYCLE_COMPLETED';
  if (entry.stoppedForBudget) return 'BUDGET_STOPPED';
  return 'IN_PROGRESS';
}

function CycleStatusBadge({
  entry,
}: {
  readonly entry: CollectionActivityEntry;
}) {
  const status = runStatus(entry);
  return (
    <StatusBadge variant={COLLECTION_RUN_STATUS_BADGE[status]}>
      {COLLECTION_RUN_STATUS_LABEL[status]}
    </StatusBadge>
  );
}

function ActivityRow({ entry }: { readonly entry: CollectionActivityEntry }) {
  const now = new Date();
  return (
    <ListRow role="listitem">
      <div className="flex w-full min-w-0 items-start gap-4 sm:w-auto sm:flex-1">
        <time
          dateTime={entry.sweepFinishedAt}
          className="flex min-w-28 flex-col text-sm"
        >
          <span className="font-medium">
            {formatRelativeTime(entry.sweepFinishedAt, now)}
          </span>
          <span className="text-xs text-muted-foreground">
            {DATE_TIME_FORMAT.format(new Date(entry.sweepFinishedAt))}
          </span>
        </time>
        <div className="grid min-w-0 flex-1 gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <ScopeBadge scope={entry.scope} />
            <CycleStatusBadge entry={entry} />
          </div>
          <CountsSummary entry={entry} />
          <RepositoryProgress entry={entry} />
        </div>
      </div>
    </ListRow>
  );
}

export interface CollectionActivityFeedProps {
  readonly entries: readonly CollectionActivityEntry[];
}

export function CollectionActivityFeed({
  entries,
}: CollectionActivityFeedProps) {
  return (
    <section aria-label="최근 수집 활동" className="flex flex-col gap-4">
      <SectionHeading title="최근 수집 활동" meta={`${entries.length}건`} />
      {entries.length > 0 ? (
        <p className="text-sm text-muted-foreground">
          전체 순회는 대상 저장소를 한 번씩 처리하는 과정입니다. 실행 시간이나
          GitHub 요청 잔여량에 따라 여러 차례로 나뉠 수 있습니다.
        </p>
      ) : null}
      {entries.length === 0 ? (
        <EmptyState
          title="아직 기록된 수집 활동이 없습니다"
          description="다음 수집 주기부터 쌓입니다."
        />
      ) : (
        <ListPanel role="list">
          {entries.map((entry, index) => (
            <ActivityRow
              key={`${entry.sweepFinishedAt}-${entry.scope}-${index}`}
              entry={entry}
            />
          ))}
        </ListPanel>
      )}
    </section>
  );
}
