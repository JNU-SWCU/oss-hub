'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';
import {
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@/components';
import { FilterChip, FilterChipGroup } from '@/components';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { programTeamDetailHref } from '@/lib/program-route';
import {
  decideApplication,
  getApplicationDetail,
  listTeamManagementApplications,
} from './api';
import {
  APPLICATION_STATUS_BADGE,
  APPLICATION_STATUS_LABELS,
  formatSubmittedAt,
} from './application-presentation';
import {
  blocksFurtherDecisions,
  decisionInputFor,
  decisionNoticeFor,
  DECISION_OPTIONS,
  runDecisionWithRefetch,
} from './application-decision-refetch';
import { ApplicationDecisionDialog } from './application-decision-dialog';
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
      setBusyId(item.id);
      const result = await runDecisionWithRefetch({
        decide: () => decideApplication(item.id, input),
        refetch: () => getApplicationDetail(item.id),
      });
      if (cancelled.current) return;
      setBusyId(null);
      setPending(null);
      setReason('');
      setReasonError(false);

      const message = decisionNoticeFor(result);
      const notice: RowNotice | null =
        message === null
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
      if (next === 'REJECTED') {
        setReason('');
        setReasonError(false);
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
              <Select
                aria-label={`${item.applicant.nickname} 신청 상태`}
                value={item.status}
                // 세 옵션은 어느 출발 상태에서도 전부 활성이다(AC-14).
                // 진행 중이거나 재조회가 실패한 행만 막는다.
                disabled={busyId === item.id || (notice?.blocked ?? false)}
                onChange={(event) =>
                  onSelectStatus(item, event.target.value as ApplicationStatus)
                }
              >
                {DECISION_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {APPLICATION_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
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
          <div className="grid gap-0.5">
            <span className="tabular-nums">
              {formatSubmittedAt(item.submittedAt)}
            </span>
            <StatusBadge variant={APPLICATION_STATUS_BADGE[item.status]}>
              {APPLICATION_STATUS_LABELS[item.status]}
            </StatusBadge>
          </div>
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
          action="REJECT"
          currentStatus={pending.item.status}
          applicantName={
            pending.item.applicant.name ?? pending.item.applicant.nickname
          }
          teamName={pending.item.team?.name ?? null}
          reason={reason}
          reasonError={reasonError}
          busy={busyId === pending.item.id}
          errorMessage={null}
          returnFocusId={`team-management-status-${pending.item.id}`}
          onReasonChange={(value) => {
            setReason(value);
            if (value.trim() !== '') setReasonError(false);
          }}
          onCancel={() => {
            setPending(null);
            setReason('');
            setReasonError(false);
          }}
          onConfirm={() => {
            void applyDecision(pending.item, pending.next, reason);
          }}
        />
      ) : null}
    </div>
  );
}
