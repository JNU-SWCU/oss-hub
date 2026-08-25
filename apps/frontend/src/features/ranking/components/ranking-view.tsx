import type { ReactNode } from 'react';
import { Download, Hourglass, ListOrdered, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DataTable,
  EmptyState,
  PageHeader,
  type DataTableColumn,
} from '@/components';
import {
  RANKING_VIEWER_CLASSES,
  type RankingPage,
  type PublicRankingItem,
  type StaffRankingItem,
} from '../types';

export type RankingViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly ranking: RankingPage }
  | { readonly kind: 'error' };

interface RankingViewProps {
  readonly page: number;
  readonly state: RankingViewState;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
  readonly onExportCsv: () => void;
  readonly isExportingCsv: boolean;
  readonly exportStatus?: 'idle' | 'preparing' | 'error';
}

/** Empty department or staff name — a blank cell looks broken. */
const EMPTY_CELL = '-';

const PUBLIC_RANKING_COLUMNS: DataTableColumn<PublicRankingItem>[] = [
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
      <a
        href={`https://github.com/${item.githubLogin}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`${item.githubLogin}의 GitHub 프로필 (새 탭에서 열림)`}
        className="break-keep whitespace-normal hover:underline"
      >
        {item.githubLogin}
      </a>
    ),
    headClassName: 'w-24',
  },
  {
    id: 'commit',
    header: 'Commit',
    cell: (item) => item.commitCount,
    cellClassName: 'text-right tabular-nums',
    headClassName: 'w-12 text-right',
  },
  {
    id: 'pr',
    header: 'PR',
    cell: (item) => item.pullRequestCount,
    cellClassName: 'text-right tabular-nums',
    headClassName: 'w-12 text-right',
  },
];

const STAFF_RANKING_COLUMNS: DataTableColumn<StaffRankingItem>[] = [
  {
    id: 'rank',
    header: '순위',
    cell: (item) => item.rank,
    headClassName: 'w-8',
  },
  {
    id: 'name',
    header: '이름',
    cell: (item) =>
      item.name === null || item.name.trim().length === 0 ? (
        <span className="text-muted-foreground" aria-label="이름 미입력">
          {EMPTY_CELL}
        </span>
      ) : (
        <span className="break-keep whitespace-normal font-medium">
          {item.name}
        </span>
      ),
    headClassName: 'w-24',
  },
  {
    id: 'member',
    header: '참여자',
    cell: (item) => (
      <a
        href={`https://github.com/${item.githubLogin}`}
        target="_blank"
        rel="noreferrer"
        aria-label={`${item.githubLogin}의 GitHub 프로필 (새 탭에서 열림)`}
        className="break-keep whitespace-normal hover:underline"
      >
        {item.githubLogin}
      </a>
    ),
    headClassName: 'w-24',
  },
  {
    id: 'department',
    header: '학과',
    cell: (item) =>
      item.department === null || item.department.trim().length === 0 ? (
        <span className="text-muted-foreground" aria-label="학과 미입력">
          {EMPTY_CELL}
        </span>
      ) : (
        <span className="break-keep whitespace-normal">{item.department}</span>
      ),
    headClassName: 'w-20',
  },
  {
    id: 'commit',
    header: 'Commit',
    cell: (item) => item.commitCount,
    cellClassName: 'text-right tabular-nums',
    headClassName: 'w-12 text-right',
  },
  {
    id: 'pr',
    header: 'PR',
    cell: (item) => item.pullRequestCount,
    cellClassName: 'text-right tabular-nums',
    headClassName: 'w-12 text-right',
  },
  {
    id: 'issue',
    header: 'Issue',
    cell: (item) => item.issueCount,
    cellClassName: 'text-right tabular-nums',
    headClassName: 'w-12 text-right',
  },
  {
    id: 'repository',
    header: 'Repo',
    cell: (item) => item.repositoryCount,
    cellClassName: 'text-right tabular-nums',
    headClassName: 'w-12 text-right',
  },
  {
    id: 'star',
    header: (
      <span className="inline-flex flex-col items-end leading-tight">
        <span>Star</span>
        <span className="font-normal text-muted-foreground">(누적)</span>
      </span>
    ),
    cell: (item) => item.starCount,
    cellClassName: 'text-right tabular-nums',
    headClassName: 'w-12 text-right',
  },
  {
    id: 'total',
    header: '합계',
    cell: (item) => item.total,
    cellClassName: 'text-right font-semibold tabular-nums',
    headClassName: 'w-12 text-right',
  },
];

function formatDataAsOf(at: Date): string {
  return new Intl.DateTimeFormat('ko-KR', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Seoul',
  }).format(at);
}

function collectionNotice(
  ranking: RankingPage,
): { readonly title: string; readonly description: string } | null {
  if (ranking.dataAsOf === null) {
    return {
      title: '아직 수집 전입니다',
      description:
        '활동을 아직 한 번도 수집하지 못했습니다. 아래 수치는 집계 결과가 아니라 수집 전 기본값(0)이며, 첫 수집이 끝나면 기준 시각과 함께 채워집니다.',
    };
  }
  const hasNoActivity =
    ranking.viewerClass === RANKING_VIEWER_CLASSES.PUBLIC
      ? ranking.items.every(
          (item) => item.commitCount + item.pullRequestCount === 0,
        )
      : ranking.items.every((item) => item.total === 0);
  if (ranking.items.length > 0 && hasNoActivity) {
    return {
      title: '집계된 활동이 아직 없습니다',
      description:
        '수집은 돌았지만 이 기간에 기록된 공개 활동이 없어 지표가 모두 0입니다. 목록에는 참여자 전원이 그대로 남아 있습니다.',
    };
  }
  return null;
}

function rankingAsOfAction(ranking: RankingPage): ReactNode {
  if (ranking.dataAsOf === null) {
    return (
      <span className="text-muted-foreground" data-ranking-as-of="none">
        아직 수집 전 · 기준 시각 없음
      </span>
    );
  }
  const iso = ranking.dataAsOf.toISOString();
  return (
    <span className="text-muted-foreground" data-ranking-as-of={iso}>
      <time dateTime={iso}>{formatDataAsOf(ranking.dataAsOf)} 기준</time>
    </span>
  );
}

export function RankingView({
  page,
  state,
  onPageChange,
  onRetry,
  onExportCsv,
  isExportingCsv,
  exportStatus = 'idle',
}: RankingViewProps) {
  const ranking = state.kind === 'ready' ? state.ranking : null;
  const showStaffFields = ranking?.viewerClass === RANKING_VIEWER_CLASSES.STAFF;
  const totalPages = ranking
    ? Math.max(1, Math.ceil(ranking.total / ranking.pageSize))
    : 1;
  const notice = ranking ? collectionNotice(ranking) : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        title="랭킹"
        description={
          showStaffFields
            ? 'Commit · PR · Issue · Repo를 합산합니다. Star는 계정 전체 누적입니다.'
            : 'Commit · PR 활동을 표시합니다.'
        }
        actions={
          ranking ? (
            <>
              {showStaffFields ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onExportCsv}
                  disabled={isExportingCsv}
                >
                  <Download data-icon="inline-start" />
                  CSV 다운로드
                </Button>
              ) : null}
            </>
          ) : null
        }
      />
      {ranking ? (
        <div
          className="flex flex-wrap items-center gap-3 text-sm"
          aria-live="polite"
        >
          {rankingAsOfAction(ranking)}
          {exportStatus === 'preparing' ? (
            <span>CSV를 준비하는 중입니다.</span>
          ) : null}
          {exportStatus === 'error' ? (
            <span role="alert">
              CSV를 준비하지 못했습니다. 다시 시도해 주세요.
            </span>
          ) : null}
        </div>
      ) : null}
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
          {notice ? (
            <Alert>
              <Hourglass />
              <AlertTitle>{notice.title}</AlertTitle>
              <AlertDescription>{notice.description}</AlertDescription>
            </Alert>
          ) : null}
          {state.kind === 'ready' && ranking && ranking.items.length === 0 ? (
            <EmptyState
              icon={<ListOrdered className="size-5" />}
              title="집계된 활동 데이터가 없습니다"
              description="참여자의 공개 GitHub 활동이 수집되면 이곳에 표시됩니다."
            />
          ) : ranking?.viewerClass === RANKING_VIEWER_CLASSES.STAFF ? (
            <DataTable
              className="[&_[data-slot=table-cell]]:px-1 [&_[data-slot=table-cell]]:text-xs [&_[data-slot=table-head]]:px-1 [&_[data-slot=table-head]]:text-xs sm:[&_[data-slot=table-cell]]:px-2 sm:[&_[data-slot=table-cell]]:text-sm sm:[&_[data-slot=table-head]]:px-2 sm:[&_[data-slot=table-head]]:text-sm"
              scrollRegionLabel="활동 랭킹 표"
              columns={STAFF_RANKING_COLUMNS}
              data={[...ranking.items]}
              rowKey={(item) => item.rank}
              isLoading={false}
              loadingSlot="랭킹을 불러오는 중입니다…"
              emptyState="표시할 데이터가 없습니다."
            />
          ) : (
            <DataTable
              className="[&_[data-slot=table-cell]]:px-1 [&_[data-slot=table-cell]]:text-xs [&_[data-slot=table-head]]:px-1 [&_[data-slot=table-head]]:text-xs sm:[&_[data-slot=table-cell]]:px-2 sm:[&_[data-slot=table-cell]]:text-sm sm:[&_[data-slot=table-head]]:px-2 sm:[&_[data-slot=table-head]]:text-sm"
              scrollRegionLabel="활동 랭킹 표"
              columns={PUBLIC_RANKING_COLUMNS}
              data={ranking === null ? [] : [...ranking.items]}
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
