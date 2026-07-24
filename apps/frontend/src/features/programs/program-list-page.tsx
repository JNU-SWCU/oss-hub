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
import { ProgramListPagination } from './program-list-pagination';
import type { ProgramRecruitmentState } from './program-list';
import type { ProgramCategory } from './program-templates';
import type {
  ProgramListItem,
  ProgramListPage as ProgramListPageData,
  ProgramListStatus,
} from './types';

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
function parseStatus(value: string): ProgramListStatus {
  if (value === 'recruiting' || value === 'closed') return value;
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

function ProgramListPage({ canCreateProgram }: ProgramListPageProps) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProgramListStatus>('all');
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
  const now = useMemo(() => new Date(), []);
  const groups = useMemo(
    () =>
      loadState.kind === 'ready'
        ? filterAndGroupPrograms(loadState.programPage.items, {
            search: '',
            status: 'all',
            now,
          })
        : [],
    [loadState, now],
  );

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
              ? '검색어나 모집 상태를 바꿔 다시 찾아보세요.'
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
          description="검색어나 모집 상태를 바꿔 다시 찾아보세요."
        />
      );
    }

    return groups.map((group) => (
      <section className="grid gap-3" key={group.key}>
        <h2 className="font-heading text-lg font-medium">{group.title}</h2>
        <CardGrid>
          {group.programs.map((program) => {
            const recruitmentState = getProgramRecruitmentState(program, now);
            const badge = RECRUITMENT_BADGES[recruitmentState];
            return (
              <ProgramCard
                category={CATEGORY_LABELS[program.category]}
                footer={
                  <Button asChild size="sm" variant="outline">
                    <Link href={programHref(program.id)}>더 보기</Link>
                  </Button>
                }
                key={program.id}
                period={formatApplicationPeriod(program)}
                status={
                  <StatusBadge variant={badge.variant}>
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
    <section className="grid gap-6">
      <PageHeader
        title="프로그램"
        description="참여할 프로그램을 찾아보세요."
      />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <Input
          aria-label="프로그램명 검색"
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          placeholder="프로그램명 검색"
          value={search}
        />
        <select
          aria-label="모집 상태 필터"
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          onChange={(event) => {
            setPage(1);
            setStatus(parseStatus(event.target.value));
          }}
          value={status}
        >
          <option value="all">전체 상태</option>
          <option value="recruiting">모집중</option>
          <option value="closed">마감</option>
        </select>
      </div>
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
