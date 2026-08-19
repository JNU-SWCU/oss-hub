import { useMemo } from 'react';
import { Hourglass, ListOrdered, RefreshCw } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DataTable,
  EmptyState,
  PageHeader,
  type DataTableColumn,
} from '@/components';
import type { RankingItem, RankingPage, RankingViewerRole } from '../types';

export type RankingViewState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly ranking: RankingPage }
  | { readonly kind: 'error' };

interface RankingViewProps {
  readonly page: number;
  readonly state: RankingViewState;
  /**
   * 이 화면을 보는 사람의 역할(`useSessionRole()`). 교직원·관리자에게만
   * 실명 열을 **더한다** — 값을 가리는 것이 아니라 열을 다는 판단이다.
   * 서버가 이미 계층별로 다른 `displayName` 을 내려주므로(공개·학생은
   * 닉네임) 여기서 실명을 지우는 경로는 없다.
   */
  readonly viewerRole?: RankingViewerRole | null;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
}

/** 학과는 미입력일 수 있다 — 빈칸은 손상처럼 보이므로 자리를 대시로 채운다. */
const EMPTY_CELL = '-';

function rankingColumns(showRealName: boolean): DataTableColumn<RankingItem>[] {
  return [
    {
      id: 'rank',
      header: '순위',
      cell: (item) => item.rank,
      headClassName: 'w-8',
    },
    ...(showRealName
      ? [
          {
            // 교직원·관리자 응답에서만 `displayName` 이 실명이다. 그 계층에서도
            // 실명이 비어 있으면 서버가 닉네임으로 내려준다 — 빈 행이 생기지 않는다.
            id: 'name',
            header: '이름',
            cell: (item: RankingItem) => (
              <span className="break-keep whitespace-normal font-medium">
                {item.displayName}
              </span>
            ),
            headClassName: 'w-24',
          } satisfies DataTableColumn<RankingItem>,
        ]
      : []),
    {
      id: 'member',
      header: '참여자',
      cell: (item) => (
        <div className="flex min-w-0 flex-col">
          {/* 실명 열이 따로 있는 계층에서는 같은 값을 두 번 적지 않는다 —
            공개·학생 계층에서는 `displayName` 이 곧 닉네임이라 이 줄이 유일한 이름이다. */}
          {showRealName ? null : (
            <span className="break-all whitespace-normal font-medium">
              {item.displayName}
            </span>
          )}
          <span className="break-all whitespace-normal text-xs text-muted-foreground">
            @{item.githubLogin}
          </span>
        </div>
      ),
      headClassName: 'w-24',
    },
    {
      // 학과는 공개 가능 정보다(owner 결정 2026-08-19) — 비로그인도 같은 열을 본다.
      id: 'department',
      header: '학과',
      // 파서가 이미 null 로 정규화하지만 여기서 다시 빈 값을 본다 — 이 칸이 통째
      // 없는 행(배포 틈의 낡은 응답)이 오면 `=== null` 은 거짓이 돼 셀이 통째
      // 비어 버린다 — 깨진 표처럼 보이는 바로 그 모양이다.
      cell: (item) => {
        const department = item.department ?? null;
        return department === null || department.trim().length === 0 ? (
          <span className="text-muted-foreground" aria-label="학과 미입력">
            {EMPTY_CELL}
          </span>
        ) : (
          <span className="break-keep whitespace-normal">{department}</span>
        );
      },
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
}

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
  viewerRole = null,
  onPageChange,
  onRetry,
}: RankingViewProps) {
  const ranking = state.kind === 'ready' ? state.ranking : null;
  // 역할을 아직 모르는 동안(`loading`)은 공개 열 구성이다 — 서버도 그때는
  // 실명을 내려주지 않으므로 빈 열이 먼저 생겼다가 채워지는 깜박이 없다.
  const columns = useMemo(
    () => rankingColumns(viewerRole === 'STAFF' || viewerRole === 'ADMIN'),
    [viewerRole],
  );
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
