import { Hourglass, ListOrdered, RefreshCw } from 'lucide-react';
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
    // 이 열만 기간 집계가 아니라 계정 전체 누적이다. 머리글에 그 말을 붙이지
    // 않으면 옆 열들과 같은 규칙으로 읽혀 "올해 받은 star"로 오해된다.
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

/**
 * "숫자가 없다"와 "수집이 아직 안 돌았다"를 화면이 구별해 말하게 하는 판정.
 *
 * 사람 축 랭킹은 **가입자 전원**을 돌려준다 — 기여가 0인 사람도 0으로 남는다.
 * 그래서 `items.length === 0`은 사실상 오지 않고, 수집이 한 번도 안 돌았을 때의
 * 화면은 "전원이 진짜로 아무것도 안 했다"는 화면과 **글자 하나 다르지 않다**.
 * 그대로 두면 이번에 고치려는 버그(학생이 0으로만 보임)와 구분이 안 된다.
 *
 * 두 상태는 원인이 다르고 동시에 나타날 수도 있다(배포 직후 첫 sweep 전).
 * 어느 쪽이든 **목록에서 사람을 빼지 않는다** — 표기만 더한다.
 */
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
  if (
    ranking.items.length > 0 &&
    ranking.items.every((item) => item.total === 0)
  ) {
    return {
      title: '집계된 활동이 아직 없습니다',
      description:
        '수집은 돌았지만 이 기간에 기록된 공개 활동이 없어 지표가 모두 0입니다. 목록에는 참여자 전원이 그대로 남아 있습니다.',
    };
  }
  return null;
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
  const notice = ranking ? collectionNotice(ranking) : null;

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <PageHeader
        title="랭킹"
        description={
          <span className="break-keep">
            참여자의 공개 GitHub 활동을 기준으로 집계합니다. Star는 해당 연도가
            아니라 계정 전체 누적 값입니다.
            {ranking ? (
              <>
                {' '}
                {ranking.dataAsOf === null ? (
                  // 시각을 그냥 숨기면 화면이 아무 말도 안 하는 것과 같다 —
                  // 수집이 멈췄는지 아직 안 돌았는지를 사용자가 구별할 수 없다.
                  <span
                    className="text-muted-foreground"
                    data-ranking-as-of="none"
                  >
                    아직 수집 전 · 기준 시각 없음
                  </span>
                ) : (
                  <span
                    className="text-muted-foreground"
                    data-ranking-as-of={ranking.dataAsOf.toISOString()}
                  >
                    {formatDataAsOf(ranking.dataAsOf)} 기준
                  </span>
                )}
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
