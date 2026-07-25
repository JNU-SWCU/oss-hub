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
import { getProgramDetail, listProgramApplications } from './api';
import { ProgramListPagination } from './program-list-pagination';
import { staffApplicationDetailHref, staffProgramHref } from './program-paths';
import type {
  ApplicationListItem,
  ApplicationListMode,
  ApplicationListPage,
  ApplicationListStatus,
  ApplicationStatus,
  ProgramDetail,
} from './types';

const PAGE_SIZE = 20;

type LoadState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly program: ProgramDetail;
      readonly applicationPage: ApplicationListPage;
    }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly message: string };

const STATUS_LABELS: Readonly<Record<ApplicationStatus, string>> = {
  SUBMITTED: '제출됨',
  APPROVED: '승인',
  REJECTED: '반려',
};

const STATUS_BADGE: Readonly<
  Record<ApplicationStatus, 'pending' | 'approved' | 'rejected'>
> = {
  SUBMITTED: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

function formatSubmittedAt(value: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Seoul',
  }).format(new Date(value));
}

function displayApplicantName(item: ApplicationListItem): string {
  return (
    item.answers.applicantName || item.applicant.name || item.applicant.nickname
  );
}

function participationLabel(item: ApplicationListItem): string {
  if (item.participation === 'TEAM' && item.team) {
    return `팀 · ${item.team.name} (${item.team.memberCount}명)`;
  }
  return '개인';
}

function ApplicantsSkeleton(): ReactElement {
  return (
    <main
      className="mx-auto grid max-w-6xl gap-6 px-4 py-8"
      aria-label="신청자 목록 불러오는 중"
    >
      <div className="h-20 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-12 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
      <div className="h-64 animate-pulse rounded-xl bg-muted motion-reduce:animate-none" />
    </main>
  );
}

export function ProgramApplicantsPage({
  programId,
}: {
  readonly programId: string;
}): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ApplicationListStatus>('all');
  const [mode, setMode] = useState<ApplicationListMode>('all');
  const [page, setPage] = useState(1);
  const latestRequestId = useRef(0);

  const load = useCallback(async (): Promise<void> => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setLoadState({ kind: 'loading' });
    try {
      const [program, applicationPage] = await Promise.all([
        getProgramDetail(programId),
        listProgramApplications(programId, {
          page,
          pageSize: PAGE_SIZE,
          search,
          status,
          mode,
        }),
      ]);
      if (requestId !== latestRequestId.current) return;
      setLoadState({ kind: 'ready', program, applicationPage });
    } catch (error: unknown) {
      if (requestId !== latestRequestId.current) return;
      if (error instanceof ApiError && error.problem.status === 404) {
        setLoadState({ kind: 'not-found' });
        return;
      }
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
        message: '신청자 목록을 불러오지 못했습니다.',
      });
    }
  }, [mode, page, programId, search, status]);

  useEffect(() => {
    void load();
  }, [load]);

  const columns = useMemo<DataTableColumn<ApplicationListItem>[]>(
    () => [
      {
        id: 'applicant',
        header: '신청자',
        cell: (row) => (
          <div className="grid gap-0.5">
            <span className="font-medium">{displayApplicantName(row)}</span>
            <span className="text-xs text-muted-foreground">
              @{row.applicant.nickname}
            </span>
          </div>
        ),
      },
      {
        id: 'participation',
        header: '구분',
        cell: (row) => participationLabel(row),
      },
      {
        id: 'title',
        header: '제목',
        cell: (row) => (
          <span className="line-clamp-2 break-keep">{row.answers.title}</span>
        ),
      },
      {
        id: 'status',
        header: '상태',
        cell: (row) => (
          <StatusBadge variant={STATUS_BADGE[row.status]}>
            {STATUS_LABELS[row.status]}
          </StatusBadge>
        ),
      },
      {
        id: 'submittedAt',
        header: '제출 시각',
        cell: (row) => formatSubmittedAt(row.submittedAt),
      },
      {
        id: 'detail',
        header: '상세',
        cell: (row) => (
          <Button asChild size="sm" variant="outline">
            <Link href={staffApplicationDetailHref(programId, row.id)}>
              보기
            </Link>
          </Button>
        ),
      },
    ],
    [programId],
  );

  if (loadState.kind === 'loading') return <ApplicantsSkeleton />;

  if (loadState.kind === 'not-found') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          title="프로그램을 찾을 수 없습니다"
          description="삭제되었거나 공개되지 않은 프로그램입니다."
          action={
            <Button asChild variant="outline">
              <Link href="/programs">프로그램 목록으로</Link>
            </Button>
          }
        />
      </main>
    );
  }

  if (loadState.kind === 'error') {
    return (
      <main className="mx-auto max-w-3xl px-4 py-12">
        <EmptyState
          title="신청자 목록을 불러오지 못했습니다"
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

  const { program, applicationPage } = loadState;
  const hasFilters = search.trim() !== '' || status !== 'all' || mode !== 'all';
  const emptyMessage = hasFilters
    ? '검색 조건에 맞는 신청자가 없습니다.'
    : '아직 제출된 신청이 없습니다.';

  return (
    <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8">
      <PageHeader
        title={`${program.name} 신청자`}
        description="프로그램 신청을 검색·필터하고 상세로 이동할 수 있습니다."
        actions={
          <Button asChild variant="outline">
            <Link href={staffProgramHref(program.id, '/edit')}>
              프로그램 편집
            </Link>
          </Button>
        }
      />

      <form
        className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setPage(1);
          void load();
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
            placeholder="이름·팀·GitHub·제목"
            aria-label="신청자 검색"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">상태</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ApplicationListStatus);
              setPage(1);
            }}
            aria-label="신청 상태 필터"
          >
            <option value="all">전체 상태</option>
            <option value="SUBMITTED">제출됨</option>
            <option value="APPROVED">승인</option>
            <option value="REJECTED">반려</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">구분</span>
          <select
            className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={mode}
            onChange={(event) => {
              setMode(event.target.value as ApplicationListMode);
              setPage(1);
            }}
            aria-label="개인/팀 필터"
          >
            <option value="all">전체</option>
            <option value="personal">개인</option>
            <option value="team">팀</option>
          </select>
        </label>
      </form>

      <DataTable
        columns={columns}
        data={[...applicationPage.items]}
        rowKey={(row) => row.id}
        emptyState={emptyMessage}
        caption={`총 ${applicationPage.totalItems}건`}
      />

      <ProgramListPagination
        page={applicationPage.page}
        totalPages={applicationPage.totalPages}
        onPageChange={setPage}
      />
    </main>
  );
}
