'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  DataTable,
  EmptyState,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@/components';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { getStaffDashboardSummary } from './api';
import { getProgramRecruitmentState } from './program-list';
import type { ProgramRecruitmentState } from './program-list';
import { ProgramListPagination } from './program-list-pagination';
import { staffProgramHref } from './program-paths';
import type { ProgramCategory } from './program-templates';
import type {
  ProgramListStatus,
  StaffDashboardProgramSummary,
  StaffDashboardSummary,
} from './types';

const PAGE_SIZE = 20;

const CATEGORY_LABELS = {
  BASIC: '기본',
  SW_VALUE_SPREAD: 'SW 가치확산',
  OSS_CONTEST: 'OSS 경진대회',
  CAPSTONE: '캡스톤',
  SW_CONVERGENCE: 'SW 융합',
  GLOBAL_MAKERTHON: '글로벌 메이커톤',
  CORPORATE_INTERNSHIP: '기업 인턴십',
} satisfies Readonly<Record<ProgramCategory, string>>;

const RECRUITMENT_BADGES = {
  scheduled: { label: '모집 예정', variant: 'pending' },
  recruiting: { label: '모집중', variant: 'recruiting' },
  closed: { label: '마감', variant: 'closed' },
} as const satisfies Readonly<
  Record<
    ProgramRecruitmentState,
    {
      readonly label: string;
      readonly variant: 'pending' | 'recruiting' | 'closed';
    }
  >
>;

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly summary: StaffDashboardSummary }
  | { readonly kind: 'error'; readonly message: string };

function formatApplicationPeriod(
  program: StaffDashboardProgramSummary,
): string {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  });
  return `${formatter.format(new Date(program.applicationPeriod.startsAt))} ~ ${formatter.format(new Date(program.applicationPeriod.endsAt))}`;
}

function parseStatus(value: string): ProgramListStatus {
  if (value === 'recruiting' || value === 'closed') return value;
  return 'all';
}

function applicantsHref(program: StaffDashboardProgramSummary): string {
  return program.applicantsPath || staffProgramHref(program.id, '/applicants');
}

function matchesRecruitment(
  program: StaffDashboardProgramSummary,
  status: ProgramListStatus,
  now: Date,
): boolean {
  if (status === 'all') return true;
  const periodLike = {
    id: program.id,
    name: program.name,
    organizer: '',
    category: program.category,
    applicationStartAt: program.applicationPeriod.startsAt,
    applicationEndAt: program.applicationPeriod.endsAt,
    description: '',
  };
  return getProgramRecruitmentState(periodLike, now) === status;
}

function DashboardSkeleton(): ReactElement {
  return (
    <main
      className="mx-auto grid max-w-6xl gap-6 px-4 py-8"
      aria-label="운영 대시보드 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-12 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

export function StaffDashboardPage(): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProgramListStatus>('all');
  const [page, setPage] = useState(1);
  const latestRequestId = useRef(0);
  const now = useMemo(() => new Date(), []);

  const load = useCallback(async (): Promise<void> => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setLoadState({ kind: 'loading' });
    try {
      const summary = await getStaffDashboardSummary();
      if (requestId !== latestRequestId.current) return;
      setLoadState({ kind: 'ready', summary });
    } catch (error: unknown) {
      if (requestId !== latestRequestId.current) return;
      if (error instanceof ApiError && error.problem.status === 403) {
        setLoadState({
          kind: 'error',
          message:
            error.problem.detail ??
            '승인된 교직원 또는 관리자만 조회할 수 있습니다.',
        });
        return;
      }
      setLoadState({
        kind: 'error',
        message: '운영 대시보드를 불러오지 못했습니다.',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredPrograms = useMemo(() => {
    if (loadState.kind !== 'ready') return [];
    const needle = search.trim().toLowerCase();
    return loadState.summary.programs.filter((program) => {
      if (!matchesRecruitment(program, status, now)) return false;
      if (!needle) return true;
      return (
        program.name.toLowerCase().includes(needle) ||
        CATEGORY_LABELS[program.category].toLowerCase().includes(needle)
      );
    });
  }, [loadState, now, search, status]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredPrograms.length / PAGE_SIZE),
  );
  const safePage = Math.min(page, totalPages);
  const pageItems = filteredPrograms.slice(
    (safePage - 1) * PAGE_SIZE,
    safePage * PAGE_SIZE,
  );

  const columns = useMemo<DataTableColumn<StaffDashboardProgramSummary>[]>(
    () => [
      {
        id: 'name',
        header: '프로그램',
        cell: (row) => (
          <div className="grid gap-0.5">
            <span className="font-medium break-keep">{row.name}</span>
            <span className="text-xs text-muted-foreground">
              {CATEGORY_LABELS[row.category]}
            </span>
          </div>
        ),
      },
      {
        id: 'period',
        header: '신청 기간',
        cell: (row) => {
          const periodLike = {
            id: row.id,
            name: row.name,
            organizer: '',
            category: row.category,
            applicationStartAt: row.applicationPeriod.startsAt,
            applicationEndAt: row.applicationPeriod.endsAt,
            description: '',
          };
          const state = getProgramRecruitmentState(periodLike, now);
          const badge = RECRUITMENT_BADGES[state];
          return (
            <div className="grid gap-1">
              <span className="text-sm">{formatApplicationPeriod(row)}</span>
              <StatusBadge variant={badge.variant}>{badge.label}</StatusBadge>
            </div>
          );
        },
      },
      {
        id: 'applications',
        header: '신청(건)',
        cell: (row) => (
          <div className="grid gap-0.5 text-sm tabular-nums">
            <span>전체 {row.applications.total}</span>
            <span className="text-muted-foreground">
              제출 {row.applications.submitted} · 승인{' '}
              {row.applications.approved} · 반려 {row.applications.rejected}
            </span>
          </div>
        ),
      },
      {
        id: 'applicants',
        header: '신청자',
        cell: (row) => (
          <Button asChild size="sm" variant="outline">
            <Link href={applicantsHref(row)}>목록</Link>
          </Button>
        ),
      },
    ],
    [now],
  );

  if (loadState.kind === 'loading') return <DashboardSkeleton />;

  if (loadState.kind === 'error') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          title="운영 대시보드를 불러오지 못했습니다"
          description={loadState.message}
          action={
            <Button type="button" onClick={() => void load()}>
              다시 시도
            </Button>
          }
        />
      </main>
    );
  }

  const hasFilters = search.trim() !== '' || status !== 'all';
  const isEmptyCatalog = loadState.summary.programs.length === 0;
  const isNoResults = !isEmptyCatalog && filteredPrograms.length === 0;

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
      <PageHeader
        title="운영 대시보드"
        description="프로그램별 신청(Application) 건수를 확인하고 신청자 목록으로 이동합니다."
      />

      <form
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
        }}
      >
        <label className="grid min-w-[12rem] flex-1 gap-1 text-sm">
          <span className="text-muted-foreground">검색</span>
          <Input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
            placeholder="프로그램 이름·유형"
            aria-label="프로그램 검색"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">모집 상태</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={status}
            onChange={(event) => {
              setStatus(parseStatus(event.target.value));
              setPage(1);
            }}
            aria-label="모집 상태 필터"
          >
            <option value="all">전체</option>
            <option value="recruiting">모집중</option>
            <option value="closed">마감</option>
          </select>
        </label>
      </form>

      {isEmptyCatalog ? (
        <EmptyState
          title="등록된 프로그램이 없습니다"
          description="프로그램을 만들면 신청 현황이 여기에 표시됩니다."
          action={
            <Button asChild>
              <Link href="/staff/programs/new">프로그램 만들기</Link>
            </Button>
          }
        />
      ) : isNoResults ? (
        <EmptyState
          title="검색 결과가 없습니다"
          description="검색어나 모집 상태 필터를 바꿔 보세요."
          action={
            hasFilters ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setSearch('');
                  setStatus('all');
                  setPage(1);
                }}
              >
                필터 초기화
              </Button>
            ) : null
          }
        />
      ) : (
        <>
          <DataTable
            columns={columns}
            data={[...pageItems]}
            rowKey={(row) => row.id}
            caption={`총 ${filteredPrograms.length}개 프로그램`}
          />
          <ProgramListPagination
            page={safePage}
            totalPages={totalPages}
            onPageChange={setPage}
          />
        </>
      )}
    </main>
  );
}
