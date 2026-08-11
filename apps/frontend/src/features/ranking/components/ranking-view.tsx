import { ListOrdered, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DataTable,
  EmptyState,
  PageHeader,
  type DataTableColumn,
} from '@/components';
import type { RankingItem, RankingPage } from '../types';

export type RankingViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly ranking: RankingPage }
  | { readonly kind: 'error' };

interface RankingViewProps {
  readonly page: number;
  readonly state: RankingViewState;
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
    id: 'release',
    header: 'Release',
    cell: (item) => item.releaseCount,
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

/**
 * 갱신 시각 표기 (ADR-010 §10).
 *
 * "언제 기준인지"만 알면 되므로 분 단위까지만 보인다. 이게 화면에 없으면
 * 수집이 멈춰도 학생은 숫자가 오늘 값인 줄 안다 — 이번 사고의 본질이 그거였다.
 */
function formatDataAsOf(at: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(at);
}

export function RankingView({
  page,
  state,
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
            {state.kind === 'ready' && state.ranking.dataAsOf !== null ? (
              <>
                {' '}
                <span
                  className="text-muted-foreground"
                  data-ranking-as-of={state.ranking.dataAsOf.toISOString()}
                >
                  {formatDataAsOf(state.ranking.dataAsOf)} 기준
                </span>
              </>
            ) : null}
          </span>
        }
      />
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
      ) : (
        <>
          {state.kind === 'ready' && ranking && ranking.items.length === 0 ? (
            <EmptyState
              icon={<ListOrdered className="size-5" />}
              title="집계된 활동 데이터가 없습니다"
              description="연결된 저장소에서 수집된 공개 GitHub 활동이 생기면 이곳에 표시됩니다."
            />
          ) : (
            <DataTable
              className="[&_[data-slot=table]]:table-fixed [&_[data-slot=table-cell]]:px-1 [&_[data-slot=table-cell]]:text-xs [&_[data-slot=table-head]]:px-1 [&_[data-slot=table-head]]:text-xs sm:[&_[data-slot=table-cell]]:px-2 sm:[&_[data-slot=table-cell]]:text-sm sm:[&_[data-slot=table-head]]:px-2 sm:[&_[data-slot=table-head]]:text-sm"
              scrollRegionLabel="활동 랭킹 표"
              columns={columns}
              data={ranking?.items ? [...ranking.items] : []}
              rowKey={(item) => item.rank}
              isLoading={state.kind === 'loading'}
              loadingSlot="랭킹을 불러오는 중입니다…"
              emptyState="표시할 데이터가 없습니다."
            />
          )}
        </>
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
