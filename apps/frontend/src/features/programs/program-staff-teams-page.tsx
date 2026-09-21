'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import {
  DataTable,
  EmptyState,
  PageHeader,
  type DataTableColumn,
} from '@/components';
import { FilterChip, FilterChipGroup } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { programTeamDetailHref } from '@/lib/program-route';
import {
  decideApplication,
  getApplicationDetail,
  listTeamManagementApplications,
} from './api';
import {
  APPLICATION_STATUS_LABELS,
  formatSubmittedAt,
} from './application-presentation';
import {
  blocksFurtherDecisions,
  decisionInputFor,
  decisionNoticeFor,
  runDecisionWithRefetch,
} from './application-decision-refetch';
import { ApplicationDecisionDialog } from './application-decision-dialog';
import { ApplicationStatusControl } from './application-status-control';
import type {
  ApplicationListStatus,
  ApplicationStatus,
  TeamManagementListItem,
} from './types';

/**
 * 교직원 팀 관리 목록. 「참여 팀」과 「신청자」로 갈라져 있던 두 화면을 하나로 합친 자리다.
 *
 * 예전에는 팀 목록과 신청 목록을 **클라이언트에서 조인**했다. 신청을 20페이지까지 긁어
 * 팀에 붙이고, 넘치면 「일부만 불러왔습니다」를 띄웠다. 팀:신청이 1:1로 확정된 뒤로 그
 * 조인은 순수 비용이라 서버 페이지네이션 한 번으로 바꿨다 — 잘림 경고도 함께 사라진다.
 *
 * 「신청 없음」 상태도 사라졌다. 팀은 이제 신청이 만들므로 신청 없는 팀이 생기지 않는다.
 *
 * 정렬은 **서버가 준 순서를 그대로 렌더한다**. 클라이언트가 다시 정렬하면 페이지 경계에서
 * 순서가 어긋난다 — 한 페이지 안에서만 맞고 전체로는 틀린 순서가 된다.
 */

/** 한 페이지 크기. backend DTO 의 `@Max(100)` 안이어야 400 을 받지 않는다. */
const PAGE_SIZE = 20;

type StatusFilter = ApplicationListStatus;

interface LoadedState {
  readonly kind: 'ready';
  readonly items: readonly TeamManagementListItem[];
  readonly page: number;
  readonly totalItems: number;
  readonly totalPages: number;
}
type ScreenState =
  { readonly kind: 'loading' } | { readonly kind: 'error' } | LoadedState;

/** 행마다 남는 판정 안내. 재조회 실패는 그 행의 다음 판정을 막는 근거이기도 하다. */
interface RowNotice {
  readonly message: string;
  readonly blocked: boolean;
}

function memberSummary(item: TeamManagementListItem): string {
  const names = (item.team?.members ?? []).map(
    (member) => member.name ?? member.nickname,
  );
  if (names.length === 0) return '—';
  if (names.length <= 3) return names.join(' · ');
  return `${names.slice(0, 3).join(' · ')} · 외 ${names.length - 3}명`;
}

export function ProgramStaffTeamsPage({
  programId,
}: {
  readonly programId: string;
}) {
  const [state, setState] = useState<ScreenState>({ kind: 'loading' });
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [notices, setNotices] = useState<Readonly<Record<string, RowNotice>>>(
    {},
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pending, setPending] = useState<{
    readonly item: TeamManagementListItem;
    readonly next: ApplicationStatus;
  } | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState(false);
  /** 창 안에 남겨 둘 실패 안내. 적용된 판정에서는 항상 null 이다. */
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const cancelled = useRef(false);

  const load = useCallback(async () => {
    setState({ kind: 'loading' });
    try {
      const result = await listTeamManagementApplications(programId, {
        page,
        pageSize: PAGE_SIZE,
        search,
        status: filter,
      });
      if (cancelled.current) return;
      setState({
        kind: 'ready',
        items: result.items,
        page: result.page,
        totalItems: result.totalItems,
        totalPages: result.totalPages,
      });
    } catch {
      if (!cancelled.current) setState({ kind: 'error' });
    }
  }, [programId, page, search, filter]);

  useEffect(() => {
    cancelled.current = false;
    void load();
    return () => {
      cancelled.current = true;
    };
  }, [load]);

  /** 검색·필터를 바꾸면 1페이지로 돌아간다 — 3페이지를 보다 조건을 바꾸면 빈 표가 된다. */
  const applySearch = useCallback(() => {
    setPage(1);
    setSearch(searchInput.trim());
  }, [searchInput]);

  const changeFilter = useCallback((next: StatusFilter) => {
    setPage(1);
    setFilter(next);
  }, []);

  const resetFilters = useCallback(() => {
    setPage(1);
    setFilter('all');
    setSearch('');
    setSearchInput('');
  }, []);

  const applyDecision = useCallback(
    async (
      item: TeamManagementListItem,
      next: ApplicationStatus,
      why: string,
    ) => {
      const input = decisionInputFor(next, why);
      if (input === null) {
        setReasonError(true);
        return;
      }
      // 이 판정이 창에서 시작됐는가 — `onSelectStatus`의 확인 조건과 같아야 한다.
      const dialogOpen =
        next === 'REJECTED' ||
        (next === 'APPROVED' && item.status === 'REJECTED');
      setBusyId(item.id);
      const result = await runDecisionWithRefetch({
        decide: () => decideApplication(item.id, input),
        refetch: () => getApplicationDetail(item.id),
      });
      if (cancelled.current) return;
      setBusyId(null);

      /*
       * 판정이 적용되지 **않은** 때는 창과 입력을 그대로 둔다.
       *
       * 닫아 버리면 교직원이 방금 적은 반려 사유를 다시 타이핑해야 한다 — 서버가
       * 5xx를 돌려준 것은 그 사람의 잘못이 아니다. 적용된 뒤에만 정리한다.
       */
      const applied = result.outcome.kind === 'applied';
      const message = decisionNoticeFor(result);
      /*
       * 창이 떠 있는 채로 실패하면 안내는 **창 안에서만** 말한다. 같은 문구를 창과
       * 행에 나란히 두면 어느 쪽이 지금 상황인지 한 번 더 생각하게 된다. 승인처럼
       * 창이 없는 경로는 그대로 행에 남긴다.
       */
      const keptOpen = !applied && dialogOpen;
      if (applied) {
        setPending(null);
        setReason('');
        setReasonError(false);
        setDecisionError(null);
      } else if (dialogOpen) {
        setDecisionError(message);
      }

      const notice: RowNotice | null =
        message === null || keptOpen
          ? null
          : { message, blocked: result.kind === 'refetch-failed' };
      setNotices((current) => {
        if (notice === null) {
          const { [item.id]: _removed, ...rest } = current;
          return rest;
        }
        return { ...current, [item.id]: notice };
      });
      if (blocksFurtherDecisions(result)) return;
      // 재조회가 준 값이 진짜 상태다 — 목록 전체를 다시 읽어 서버 정렬도 같이 맞춘다.
      await load();
    },
    [load],
  );

  const onSelectStatus = useCallback(
    (item: TeamManagementListItem, next: ApplicationStatus) => {
      if (next === item.status) return;
      /*
       * 확인을 거치는 두 경우다.
       *
       * 1. 반려 — 사유가 필요하다.
       * 2. 반려된 신청을 승인 — 지금 남아 있는 반려 사유가 **지워진다**.
       *    누르고 나서 사유가 사라졌다는 것을 뒤에 알게 되면 교직원은 자기가 무엇을
       *    눌렀는지 모른다. 창은 이미 그 문구를 가지고 있었고, 여기서 열어 주지 않아
       *    닿지 않고 있었다.
       */
      const needsConfirm =
        next === 'REJECTED' ||
        (next === 'APPROVED' && item.status === 'REJECTED');
      if (needsConfirm) {
        setReason('');
        setReasonError(false);
        setDecisionError(null);
        setPending({ item, next });
        return;
      }
      void applyDecision(item, next, '');
    },
    [applyDecision],
  );

  const items = state.kind === 'ready' ? state.items : [];
  const totalItems = state.kind === 'ready' ? state.totalItems : 0;
  const totalPages = state.kind === 'ready' ? state.totalPages : 0;

  const columns = useMemo<DataTableColumn<TeamManagementListItem>[]>(
    () => [
      {
        id: 'team',
        header: '팀 · 구성',
        cell: (item) => (
          <div className="grid gap-0.5">
            {item.team === null ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              <Link
                href={programTeamDetailHref(programId, item.team.id)}
                className="font-medium break-keep underline underline-offset-2"
              >
                {item.team.name}
              </Link>
            )}
            <span className="text-xs break-keep text-muted-foreground">
              {memberSummary(item)}
            </span>
          </div>
        ),
      },
      {
        id: 'applicant',
        header: '대표 신청자',
        cell: (item) => (
          <div className="grid gap-0.5">
            <span className="break-keep">
              {item.applicant.name ?? item.applicant.nickname}
            </span>
            <span className="text-xs text-muted-foreground">
              @{item.applicant.nickname}
            </span>
          </div>
        ),
      },
      {
        id: 'status',
        header: '상태',
        cell: (item) => {
          const notice = notices[item.id] ?? null;
          return (
            <div className="grid min-w-[9rem] gap-1">
              <ApplicationStatusControl
                id={`team-management-status-${item.id}`}
                aria-label={`${item.applicant.nickname} 신청 상태`}
                value={item.status}
                // 세 옵션은 어느 출발 상태에서도 전부 활성이다(AC-14).
                // 진행 중이거나 재조회가 실패한 행만 막는다.
                disabled={busyId === item.id || (notice?.blocked ?? false)}
                onChange={(next) => onSelectStatus(item, next)}
              />
              {notice !== null ? (
                <span
                  role="status"
                  className="text-xs break-keep text-muted-foreground"
                >
                  {notice.message}
                </span>
              ) : null}
            </div>
          );
        },
      },
      {
        id: 'submittedAt',
        header: '최근 제출',
        cell: (item) => (
          <span className="tabular-nums">
            {formatSubmittedAt(item.submittedAt)}
          </span>
        ),
      },
    ],
    [programId, notices, busyId, onSelectStatus],
  );

  if (state.kind === 'error') {
    return (
      <div className="grid gap-4 p-4 sm:p-6">
        <PageHeader title="팀 관리" />
        <Alert variant="destructive">
          <AlertCircle aria-hidden="true" />
          <AlertTitle>팀 목록을 불러오지 못했습니다</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-3">
            <span>
              잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 알려
              주세요.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void load()}
            >
              <RotateCcw aria-hidden="true" />
              다시 시도
            </Button>
          </AlertDescription>
        </Alert>
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-4 sm:p-6">
      <PageHeader
        title="팀 관리"
        description="팀 구성과 신청 상태를 함께 봅니다. 상태를 바꾸면 그 행을 다시 읽어 갱신합니다."
      />

      <FilterChipGroup aria-label="상태 필터">
        {(
          [
            ['all', '전체'],
            ['SUBMITTED', APPLICATION_STATUS_LABELS.SUBMITTED],
            ['APPROVED', APPLICATION_STATUS_LABELS.APPROVED],
            ['REJECTED', APPLICATION_STATUS_LABELS.REJECTED],
          ] as const
        ).map(([value, label]) => (
          <FilterChip
            key={value}
            pressed={filter === value}
            onClick={() => changeFilter(value)}
          >
            {label}
          </FilterChip>
        ))}
      </FilterChipGroup>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          applySearch();
        }}
      >
        <Input
          aria-label="팀 검색"
          placeholder="팀명 · 팀원 이름 · GitHub 계정으로 검색"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
        />
        {/*
         * 검색은 서버가 한다 — 타이핑마다 요청을 보내지 않고 확정했을 때 한 번 보낸다.
         * 글자마다 보내면 페이지가 계속 1로 돌아가 사용자가 읽던 자리를 잃는다.
         */}
        <Button type="submit" variant="outline">
          검색
        </Button>
      </form>

      <DataTable
        scrollRegionLabel="팀 관리 목록 표"
        columns={columns}
        data={[...items]}
        rowKey={(item) => item.id}
        isLoading={state.kind === 'loading'}
        caption={`${totalItems}팀 중 ${items.length}팀을 표시합니다. 표를 좌우로 스크롤할 수 있습니다.`}
        emptyState={
          search === '' && filter === 'all' ? (
            <EmptyState
              title="아직 신청한 팀이 없습니다"
              description="학생이 신청하면 여기에 표시됩니다."
            />
          ) : (
            <EmptyState
              title="조건에 맞는 팀이 없습니다"
              description="검색어나 상태 필터를 바꿔 보세요."
              action={
                <Button type="button" variant="outline" onClick={resetFilters}>
                  필터 초기화
                </Button>
              }
            />
          )
        }
      />

      {totalPages > 1 ? (
        <nav aria-label="목록 페이지" className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((current) => Math.max(1, current - 1))}
          >
            이전
          </Button>
          <span className="text-small tabular-nums text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() =>
              setPage((current) => Math.min(totalPages, current + 1))
            }
          >
            다음
          </Button>
        </nav>
      ) : null}

      {pending !== null ? (
        <ApplicationDecisionDialog
          // 무엇을 확인하는 창인지는 **고른 상태**가 정한다 — 반려만 확인하던 시절의
          // 고정값을 남겨 두면 승인 확인이 「신청 반려」라고 말한다.
          action={pending.next === 'REJECTED' ? 'REJECT' : 'APPROVE'}
          currentStatus={pending.item.status}
          applicantName={
            pending.item.applicant.name ?? pending.item.applicant.nickname
          }
          teamName={pending.item.team?.name ?? null}
          reason={reason}
          reasonError={reasonError}
          busy={busyId === pending.item.id}
          errorMessage={decisionError}
          returnFocusId={`team-management-status-${pending.item.id}`}
          onReasonChange={(value) => {
            setReason(value);
            if (value.trim() !== '') setReasonError(false);
          }}
          onCancel={() => {
            setPending(null);
            setReason('');
            setReasonError(false);
            setDecisionError(null);
          }}
          onConfirm={() => {
            void applyDecision(pending.item, pending.next, reason);
          }}
        />
      ) : null}
    </div>
  );
}
