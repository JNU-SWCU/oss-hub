'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { getProgramDetail, listProgramApplications } from './api';
import {
  APPLICATION_STATUS_BADGE,
  APPLICATION_STATUS_LABELS,
  PROVISIONING_LABELS,
  REVIEW_ACTION_LABEL,
  displayAnswerText,
  displayApplicantName,
  formatSubmittedAt,
  participationLabel,
} from './application-presentation';
import { ProgramListPagination } from './program-list-pagination';
import {
  programApplicationDetailHref,
  programEditHref,
} from '@/lib/program-route';
import type {
  ApplicationListItem,
  ApplicationListPage,
  ApplicationListStatus,
  ProgramDetail,
  RepositoryProvisioningJobStatus,
} from './types';

const PAGE_SIZE = 20;
const INITIAL_POLL_INTERVAL_MS = 2_000;
const MAX_POLL_INTERVAL_MS = 10_000;
const MAX_POLL_ATTEMPTS = 8;
const POLLED_STATUSES = new Set<RepositoryProvisioningJobStatus>([
  'PENDING',
  'PROCESSING',
  'RETRYABLE_FAILED',
]);
function pollIntervalMs(attempt: number): number {
  return Math.min(
    INITIAL_POLL_INTERVAL_MS * 2 ** attempt,
    MAX_POLL_INTERVAL_MS,
  );
}
export class ApplicationListRequestEpoch {
  private current = 0;

  begin(): number {
    this.current += 1;
    return this.current;
  }

  invalidate(): void {
    this.current += 1;
  }

  isCurrent(requestEpoch: number): boolean {
    return requestEpoch === this.current;
  }
}

type LoadState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly program: ProgramDetail;
      readonly applicationPage: ApplicationListPage;
    }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'error'; readonly message: string };
type Notice = {
  readonly kind: 'success' | 'error';
  readonly title: string;
  readonly message: string;
} | null;

function ApplicantsSkeleton(): ReactElement {
  return (
    <main
      className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8"
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
  const [page, setPage] = useState(1);
  const [notice, setNotice] = useState<Notice>(null);
  const requestEpoch = useRef(new ApplicationListRequestEpoch());
  const pollAttempts = useRef(0);
  const router = useRouter();

  const applicationParams = useCallback(
    () => ({ page, pageSize: PAGE_SIZE, search, status }),
    [page, search, status],
  );
  const reloadApplications = useCallback(async (): Promise<void> => {
    const epoch = requestEpoch.current.begin();
    const applicationPage = await listProgramApplications(
      programId,
      applicationParams(),
    );
    if (!requestEpoch.current.isCurrent(epoch)) return;
    setLoadState((current) =>
      current.kind === 'ready' ? { ...current, applicationPage } : current,
    );
  }, [applicationParams, programId]);

  const load = useCallback(async (): Promise<void> => {
    const epoch = requestEpoch.current.begin();
    setLoadState({ kind: 'loading' });
    try {
      const [program, applicationPage] = await Promise.all([
        getProgramDetail(programId),
        listProgramApplications(programId, applicationParams()),
      ]);
      if (requestEpoch.current.isCurrent(epoch))
        setLoadState({ kind: 'ready', program, applicationPage });
    } catch (error: unknown) {
      if (!requestEpoch.current.isCurrent(epoch)) return;
      if (error instanceof ApiError && error.problem.status === 404)
        setLoadState({ kind: 'not-found' });
      else if (error instanceof ApiError && error.problem.status === 403)
        setLoadState({
          kind: 'error',
          message:
            error.problem.detail ??
            '승인된 교직원 또는 관리자만 조회할 수 있습니다.',
        });
      else
        setLoadState({
          kind: 'error',
          message: '신청자 목록을 불러오지 못했습니다.',
        });
    }
  }, [applicationParams, programId]);

  useEffect(() => {
    void load();
    return () => requestEpoch.current.invalidate();
  }, [load]);

  const shouldPoll =
    loadState.kind === 'ready' &&
    loadState.applicationPage.items.some((item) =>
      POLLED_STATUSES.has(item.repositoryProvisioning.jobStatus),
    );
  useEffect(() => {
    if (!shouldPoll) {
      pollAttempts.current = 0;
      return;
    }
    if (pollAttempts.current >= MAX_POLL_ATTEMPTS) return;

    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      if (cancelled || pollAttempts.current >= MAX_POLL_ATTEMPTS) return;
      timer = window.setTimeout(() => {
        pollAttempts.current += 1;
        void reloadApplications().catch(() => {
          if (cancelled) return;
          setNotice({
            kind: 'error',
            title: '저장소 상태 확인 실패',
            message: '현재 상태를 유지하고 상태 확인을 계속합니다.',
          });
          schedule();
        });
      }, pollIntervalMs(pollAttempts.current));
    };

    schedule();
    return () => {
      cancelled = true;
      requestEpoch.current.invalidate();
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [reloadApplications, shouldPoll, loadState]);

  const columns = useMemo<DataTableColumn<ApplicationListItem>[]>(
    () => [
      {
        id: 'applicant',
        header: '신청자',
        cell: (row) => (
          <div className="grid gap-0.5">
            <span className="font-medium">{displayApplicantName(row)}</span>
            <span className="text-xs text-muted-foreground">
              @{displayAnswerText(row.applicant.nickname)}
            </span>
          </div>
        ),
      },
      { id: 'participation', header: '팀/인원', cell: participationLabel },
      {
        id: 'title',
        header: '제목',
        cell: (row) => (
          <span className="line-clamp-2 break-keep">
            {displayAnswerText(row.answers.title)}
          </span>
        ),
      },
      {
        id: 'status',
        header: '상태',
        cell: (row) => (
          <div className="grid gap-1">
            <StatusBadge variant={APPLICATION_STATUS_BADGE[row.status]}>
              {APPLICATION_STATUS_LABELS[row.status]}
            </StatusBadge>
            {row.rejectionReason ? (
              <span className="max-w-48 text-xs text-muted-foreground">
                {row.rejectionReason}
              </span>
            ) : null}
          </div>
        ),
      },
      {
        id: 'repository',
        header: '저장소 작업',
        cell: (row) => (
          <div className="grid gap-1">
            <span
              title={row.repositoryProvisioning.safeErrorClass ?? undefined}
            >
              {PROVISIONING_LABELS[row.repositoryProvisioning.jobStatus]}
            </span>
            <span className="text-xs text-muted-foreground">
              {row.isRepositoryPublicationPlanned ? '공개 예정' : '비공개 예정'}
            </span>
          </div>
        ),
      },
      {
        id: 'submittedAt',
        header: '제출 시각',
        cell: (row) => formatSubmittedAt(row.submittedAt),
      },
      {
        id: 'actions',
        header: '작업',
        // 판정은 이 행이 아니라 신청 상세에서 한다 — 여기는 그리로 보내는
        // 링크뿐이다([#869]). 행 전체 클릭도 같은 목적지로 간다(아래
        // `onRowClick`); 이 링크는 키보드·스크린리더 사용자의 유일한 동선이라
        // 행 클릭을 더해도 남겨 둔다.
        cell: (row) => (
          <Button asChild size="sm" variant="outline">
            <Link href={programApplicationDetailHref(programId, row.id)}>
              {REVIEW_ACTION_LABEL}
            </Link>
          </Button>
        ),
      },
    ],
    [programId],
  );

  if (loadState.kind === 'loading') return <ApplicantsSkeleton />;
  if (loadState.kind === 'not-found')
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
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
  if (loadState.kind === 'error')
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-12">
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

  const { program, applicationPage } = loadState;
  const hasFilters = search.trim() !== '' || status !== 'all';
  return (
    <main className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-8">
      <PageHeader
        title={`${program.name} 신청자`}
        description="프로그램 신청을 검색·필터하고 상세로 이동할 수 있습니다."
        actions={
          <Button asChild variant="outline">
            <Link href={programEditHref(program.id)}>프로그램 편집</Link>
          </Button>
        }
      />
      {notice ? (
        <Alert variant={notice.kind === 'error' ? 'destructive' : 'default'}>
          <AlertTitle>{notice.title}</AlertTitle>
          <AlertDescription>{notice.message}</AlertDescription>
        </Alert>
      ) : null}
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
          <Select
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as ApplicationListStatus);
              setPage(1);
            }}
            aria-label="신청 상태 필터"
          >
            <option value="all">전체 상태</option>
            <option value="SUBMITTED">
              {APPLICATION_STATUS_LABELS.SUBMITTED}
            </option>
            <option value="APPROVED">
              {APPLICATION_STATUS_LABELS.APPROVED}
            </option>
            <option value="REJECTED">
              {APPLICATION_STATUS_LABELS.REJECTED}
            </option>
          </Select>
        </label>
      </form>
      {/* 신청자 표는 열이 많아 사이드바가 있는 1440에서도 폭이 모자란다. 이 화면에서
          실제로 하는 일(검토하기로 상세 이동)이 맨 오른쪽 열에 있어, 밀 수 있다는 것을
          알리지 않으면 할 수 있는 일이 없는 화면처럼 보인다. 감사 로그·제출 현황이
          쓰는 안내 문구와 같은 방식으로 맞춘다. */}
      <p
        id="applicants-table-scroll-hint"
        className="text-sm text-muted-foreground"
      >
        표를 좌우로 스크롤할 수 있습니다.
      </p>
      <DataTable
        aria-describedby="applicants-table-scroll-hint"
        scrollRegionLabel="신청자 목록 표"
        columns={columns}
        data={[...applicationPage.items]}
        rowKey={(row) => row.id}
        // 행 전체 클릭은 마우스 사용자를 위한 보조 동선이다 — 「검토하기」
        // 링크가 키보드·스크린리더 사용자의 동선을 그대로 담당한다([#869]).
        // `<tr>`을 `<Link>`/`<a>`로 감쌀 수 없어(table 구조가 깨진다) 여기서는
        // `router.push`로 이동한다 — 셀 안 링크는 그대로 둬서 새 탭 열기·
        // 가운데 클릭 같은 네이티브 동작은 그 링크가 그대로 담당한다.
        onRowClick={(row) =>
          router.push(programApplicationDetailHref(programId, row.id))
        }
        emptyState={
          hasFilters
            ? '검색 조건에 맞는 신청자가 없습니다.'
            : '아직 제출된 신청이 없습니다.'
        }
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
