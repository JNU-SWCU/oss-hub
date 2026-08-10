import {
  EmptyState,
  ListPanel,
  ListRow,
  SectionHeading,
  StatusBadge,
} from '@/components';
import { formatRelativeTime } from '../format-relative-time';
import type { CollectionActivityEntry } from '../types';

/**
 * `scope`는 백엔드 원값이다 — 알려진 값만 한국어로 옮기고, 목록에 없는 값은
 * `collection-streams-table.tsx`의 에러코드 fallback과 같은 원칙으로 원문을
 * monospace로 보여준다.
 */
const SCOPE_LABEL: Record<string, string> = {
  ORG: '조직',
  EXTERNAL: '외부',
};

function ScopeBadge({ scope }: { readonly scope: string }) {
  const label = SCOPE_LABEL[scope];
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

function CountsSummary({ entry }: { readonly entry: CollectionActivityEntry }) {
  const total =
    entry.insertedCommitCount +
    entry.insertedPullRequestCount +
    entry.insertedReleaseCount;
  if (total === 0) {
    return (
      <span className="text-sm text-muted-foreground">신규 데이터 없음</span>
    );
  }
  return (
    <span className="text-sm">
      커밋 {entry.insertedCommitCount} · PR {entry.insertedPullRequestCount} ·
      릴리즈 {entry.insertedReleaseCount}
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
 */
function CycleStatusBadge({
  entry,
}: {
  readonly entry: CollectionActivityEntry;
}) {
  if (entry.cycleCompleted) {
    return <StatusBadge variant="approved">사이클 완료</StatusBadge>;
  }
  if (entry.stoppedForBudget) {
    return <StatusBadge variant="pending">예산 중단</StatusBadge>;
  }
  return <StatusBadge variant="recruiting">진행 중</StatusBadge>;
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
