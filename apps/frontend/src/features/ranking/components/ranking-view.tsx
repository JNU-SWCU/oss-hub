import { ListOrdered, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DataTable,
  EmptyState,
  PageHeader,
  type DataTableColumn,
} from '@/components';
import {
  RANKING_NOTICE,
  RANKING_PERIODS,
  type RankingItem,
  type RankingPage,
  type RankingPeriod,
} from '../types';

export type RankingViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly ranking: RankingPage }
  | { readonly kind: 'error' };

interface RankingViewProps {
  readonly period: RankingPeriod;
  readonly page: number;
  readonly state: RankingViewState;
  readonly onPeriodChange: (period: RankingPeriod) => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
}

const columns: DataTableColumn<RankingItem>[] = [
  {
    id: 'rank',
    header: '순위',
    cell: (item) => item.rank,
    headClassName: 'w-8',
  },
  {
    id: 'member',
    header: '참여자',
    cell: (item) => (
      <div className="flex min-w-0 flex-col">
        <span className="break-all whitespace-normal font-medium">
          {item.displayName}
        </span>
        <span className="break-all whitespace-normal text-xs text-muted-foreground">
          @{item.githubLogin}
        </span>
      </div>
    ),
    headClassName: 'w-24',
  },
  {
    id: 'commit',
    header: 'Commit',
    cell: (item) => item.commitCount,
    cellClassName: 'text-right',
    headClassName: 'w-12 text-right',
  },
  {
    id: 'pr',
    header: 'PR',
    cell: (item) => item.prCount,
    cellClassName: 'text-right',
    headClassName: 'w-12 text-right',
  },
  {
    id: 'star',
    header: 'Star',
    cell: (item) => item.starCount,
    cellClassName: 'text-right',
    headClassName: 'w-12 text-right',
  },
  {
    id: 'total',
    header: '합계',
    cell: (item) => item.total,
    cellClassName: 'text-right font-semibold',
    headClassName: 'w-12 text-right',
  },
];

function PeriodButtons({
  period,
  onPeriodChange,
}: Pick<RankingViewProps, 'period' | 'onPeriodChange'>) {
  return (
    <div
      className="flex w-fit rounded-lg border border-border p-1"
      aria-label="랭킹 기간"
    >
      <Button
        type="button"
        size="sm"
        aria-pressed={period === RANKING_PERIODS.THIS_YEAR}
        variant={period === RANKING_PERIODS.THIS_YEAR ? 'secondary' : 'ghost'}
        onClick={() => onPeriodChange(RANKING_PERIODS.THIS_YEAR)}
      >
        올해
      </Button>
      <Button
        type="button"
        size="sm"
        aria-pressed={period === RANKING_PERIODS.ALL}
        variant={period === RANKING_PERIODS.ALL ? 'secondary' : 'ghost'}
        onClick={() => onPeriodChange(RANKING_PERIODS.ALL)}
      >
        전체
      </Button>
    </div>
  );
}

export function RankingView({
  period,
  page,
  state,
  onPeriodChange,
  onPageChange,
  onRetry,
}: RankingViewProps) {
  const ranking = state.kind === 'ready' ? state.ranking : null;
  const totalPages = ranking
    ? Math.max(1, Math.ceil(ranking.total / ranking.pageSize))
    : 1;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        title="랭킹"
        description={
          <span className="break-keep">
            OSS Hub에 연결된 공개 GitHub 활동을 기준으로 집계합니다.
          </span>
        }
      />
      <PeriodButtons period={period} onPeriodChange={onPeriodChange} />
      {state.kind === 'error' ? (
        <Alert variant="destructive">
          <AlertTitle>랭킹을 불러오지 못했습니다.</AlertTitle>
          <AlertDescription className="flex flex-col items-start gap-3">
            <span>잠시 후 다시 시도해 주세요.</span>
            <Button type="button" variant="outline" onClick={onRetry}>
              <RefreshCw data-icon="inline-start" />
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}
      <Alert>
        <AlertTitle>집계 안내</AlertTitle>
        <AlertDescription className="break-keep">
          {RANKING_NOTICE} Star는 해당 기간에 받은 WatchEvent.started 활동
          수이며, 저장소의 현재 스타 수가 아닙니다.
        </AlertDescription>
      </Alert>
      {state.kind === 'ready' && ranking && ranking.items.length === 0 ? (
        <EmptyState
          icon={<ListOrdered className="size-5" />}
          title="집계된 활동 데이터가 없습니다"
          description="연결된 저장소에서 수집된 공개 GitHub 활동이 생기면 이곳에 표시됩니다."
        />
      ) : (
        <DataTable
          className="[&_[data-slot=table]]:table-fixed [&_[data-slot=table-cell]]:px-1 [&_[data-slot=table-cell]]:text-xs [&_[data-slot=table-head]]:px-1 [&_[data-slot=table-head]]:text-xs sm:[&_[data-slot=table-cell]]:px-2 sm:[&_[data-slot=table-cell]]:text-sm sm:[&_[data-slot=table-head]]:px-2 sm:[&_[data-slot=table-head]]:text-sm"
          columns={columns}
          data={ranking?.items ? [...ranking.items] : []}
          rowKey={(item) => item.rank}
          isLoading={state.kind === 'loading'}
          loadingSlot="랭킹을 불러오는 중입니다…"
          emptyState="표시할 데이터가 없습니다."
          caption="공개 GitHub 활동 랭킹"
        />
      )}
      {ranking && ranking.total > ranking.pageSize ? (
        <nav
          className="flex items-center justify-end gap-3"
          aria-label="랭킹 페이지"
        >
          <Button
            type="button"
            variant="outline"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            이전
          </Button>
          <span className="text-sm text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            다음
          </Button>
        </nav>
      ) : null}
    </main>
  );
}
