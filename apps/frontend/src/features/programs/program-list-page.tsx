'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import {
  CardGrid,
  EmptyState,
  PageHeader,
  ProgramCard,
  StatusBadge,
} from '@/components';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { listPrograms } from './api';
import { programHref } from './program-paths';
import {
  filterAndGroupPrograms,
  getProgramRecruitmentState,
} from './program-list';
import type { ProgramRecruitmentState } from './program-list';
import { ProgramListPagination } from './program-list-pagination';
import { ProgramListStatusChips } from './program-list-status-nav';
import type { ProgramCategory } from './program-templates';
import type {
  ProgramListItem,
  ProgramListPage as ProgramListPageData,
  ProgramListStatus,
} from './types';
import { PROGRAM_LIST_STATUSES, programListHref } from './types';

interface ProgramListPageProps {
  readonly canCreateProgram: boolean;
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly programPage: ProgramListPageData }
  | { readonly kind: 'error'; readonly message: string };

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

function formatApplicationPeriod(program: ProgramListItem): string {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  });
  return `${formatter.format(new Date(program.applicationStartAt))} ~ ${formatter.format(new Date(program.applicationEndAt))}`;
}

const RECRUITMENT_BADGES = {
  upcoming: { label: '접수대기', variant: 'pending' },
  recruiting: { label: '모집중', variant: 'recruiting' },
  in_progress: { label: '진행중', variant: 'approved' },
  ended: { label: '종료', variant: 'closed' },
} as const satisfies Readonly<
  Record<
    ProgramRecruitmentState,
    {
      readonly label: string;
      readonly variant: 'pending' | 'recruiting' | 'closed' | 'approved';
    }
  >
>;

function parseStatus(value: string | null): ProgramListStatus {
  if (
    value !== null &&
    (PROGRAM_LIST_STATUSES as readonly string[]).includes(value)
  ) {
    return value as ProgramListStatus;
  }
  return 'all';
}

function ProgramListSkeleton(): ReactElement {
  return (
    <CardGrid aria-busy="true" aria-label="프로그램 목록을 불러오는 중">
      {[0, 1, 2].map((index) => (
        <div className="h-48 animate-pulse rounded-xl bg-muted" key={index} />
      ))}
    </CardGrid>
  );
}

/**
 * 상태 필터는 **전역 사이드 패널**(프로그램 메뉴)이 URL `?status=` 로 보낸다.
 * 이 페이지는 그 쿼리를 읽고, 좁은 폭에서만 칩으로 같은 전환을 제공한다.
 */
function ProgramListPage({ canCreateProgram }: ProgramListPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = parseStatus(searchParams.get('status'));

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const latestRequestId = useRef(0);
  const hasFilters = search.trim() !== '' || status !== 'all';

  const load = useCallback(async (): Promise<void> => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setLoadState({ kind: 'loading' });
    try {
      const programPage = await listPrograms({
        page,
        pageSize: PAGE_SIZE,
        search,
        status,
      });
      if (requestId !== latestRequestId.current) return;
      setLoadState({ kind: 'ready', programPage });
    } catch (error: unknown) {
      if (requestId !== latestRequestId.current) return;
      setLoadState({
        kind: 'error',
        message:
          error instanceof ApiError
            ? error.message
            : '프로그램 목록을 불러오지 못했습니다.',
      });
    }
  }, [page, search, status]);

  useEffect(() => {
    void load();
    return () => {
      latestRequestId.current += 1;
    };
  }, [load]);

  // status 쿼리가 바뀌면 1페이지로
  useEffect(() => {
    setPage(1);
  }, [status]);

  const now = useMemo(() => new Date(), []);
  const groups = useMemo(
    () =>
      loadState.kind === 'ready'
        ? filterAndGroupPrograms(loadState.programPage.items, {
            search: '',
            status,
            now,
          })
        : [],
    [loadState, now, status],
  );

  const goStatus = (next: ProgramListStatus) => {
    router.push(programListHref(next));
  };

  const content = (() => {
    if (loadState.kind === 'loading') return <ProgramListSkeleton />;
    if (loadState.kind === 'error') {
      return (
        <EmptyState
          title="프로그램 목록을 불러오지 못했습니다"
          description={loadState.message}
          action={<Button onClick={() => void load()}>다시 시도</Button>}
        />
      );
    }
    if (loadState.programPage.items.length === 0) {
      return (
        <EmptyState
          title={
            hasFilters
              ? '조건에 맞는 프로그램이 없습니다'
              : '등록된 프로그램이 없습니다'
          }
          description={
            hasFilters
              ? '검색어나 프로그램 상태를 바꿔 다시 찾아보세요.'
              : '새 프로그램이 등록되면 이곳에서 확인할 수 있습니다.'
          }
          action={
            canCreateProgram && !hasFilters ? (
              <Button asChild>
                <Link href="/staff/programs/new">프로그램 만들기</Link>
              </Button>
            ) : undefined
          }
        />
      );
    }
    if (groups.length === 0) {
      return (
        <EmptyState
          title="조건에 맞는 프로그램이 없습니다"
          description="검색어나 프로그램 상태를 바꿔 다시 찾아보세요."
        />
      );
    }

    return groups.map((group) => (
      <section className="grid gap-3" key={group.key}>
        {status === 'all' ? (
          <h2 className="font-heading text-lg font-medium">{group.title}</h2>
        ) : null}
        <CardGrid>
          {group.programs.map((program) => {
            const recruitmentState = getProgramRecruitmentState(program, now);
            const badge = RECRUITMENT_BADGES[recruitmentState];
            return (
              <ProgramCard
                category={CATEGORY_LABELS[program.category]}
                href={programHref(program.id)}
                key={program.id}
                period={formatApplicationPeriod(program)}
                statusPlacement="body-center"
                status={
                  <StatusBadge size="lg" variant={badge.variant}>
                    {badge.label}
                  </StatusBadge>
                }
                title={program.name}
              >
                <span>{program.organizer}</span>
              </ProgramCard>
            );
          })}
        </CardGrid>
      </section>
    ));
  })();

  return (
    <section className="grid gap-6 p-4 sm:p-6">
      <PageHeader
        title="프로그램"
        description="참여할 프로그램을 찾아보세요. 상태는 왼쪽 프로그램 메뉴에서 고릅니다."
      />
      {/* 좁은 폭: 전역 사이드가 가로 띠라 상태 칩을 본문에 한 번 더 둔다 */}
      <ProgramListStatusChips
        className="min-[900px]:hidden"
        value={status}
        onChange={goStatus}
      />
      <Input
        aria-label="프로그램명 검색"
        onChange={(event) => {
          setPage(1);
          setSearch(event.target.value);
        }}
        placeholder="프로그램명 검색"
        value={search}
      />
      {content}
      <ProgramListPagination
        onPageChange={setPage}
        page={page}
        totalPages={
          loadState.kind === 'ready' ? loadState.programPage.totalPages : 0
        }
      />
    </section>
  );
}

export { ProgramListPage };
