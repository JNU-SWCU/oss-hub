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

/**
 * `scope`는 백엔드 원값이다(`collection-sync.service.ts`) — org sweep은
 * `` `org:${organizationLogin}` ``, external sweep은 고정값 `"external"`이다.
 * 조직 로그인마다 값이 달라지므로 정확히 일치시키는 map이 아니라 접두사·고정값
 * 판별로 분류하고, 그 외 값은 `collection-streams-table.tsx`의 에러코드
 * fallback과 같은 원칙으로 원문을 monospace로 보여준다.
 */
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

/**
 * `system-status-view.tsx`와 같은 절대 시각 포맷 — 상대 시각과 병기한다.
 */
const DATE_TIME_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

/**
 * 「Commit 3 · PR 2 · Release 0 · Issue 1」 — 좁은 화면에서도 이름과 숫자가 다른 줄로 갈리지 않게
 * 「이름 숫자 ·」 묶음 사이에서만 줄을 바꾼다.
 */
export function MetricCounts({
  counts,
}: {
  readonly counts: readonly (readonly [label: string, count: number])[];
}) {
  // 묶음 사이 띄어쓰기는 묶음 밖에 둔다 — 안에 두면 줄을 바꿀 자리가 사라져 한 줄로 넘친다.
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

/**
 * `cycleCompleted`가 우선이다 — 완료된 사이클이면 이번 sweep이 예산 때문에
 * 멈췄었는지는 더 이상 중요하지 않다. `stoppedForBudget`은 사이클이 아직
 * 진행 중임을 전제로 한 상태이므로("사이클 진행 중" 의미) 그 다음으로 본다.
 * 저장소 연결 즉시 수집은 사이클이 아니라 저장소 하나라 끝났는지만 말한다(#1133).
 */
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
            // sweepFinishedAt만으로는 유일성을 보장할 수 없다(같은 시각에 여러
            // scope가 끝날 수 있음) — scope와 조합해 키를 만든다.
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
