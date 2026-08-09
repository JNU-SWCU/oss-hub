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
import { CardGrid, EmptyState, PageHeader, ProgramCard } from '@/components';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { listPrograms } from './api';
import { programNewHref } from '@/lib/program-route';
import { programHref } from './program-paths';
import {
  filterAndGroupPrograms,
  getProgramListBadge,
  getProgramListHeading,
  getProgramListSubtitle,
} from './program-list';
import { ProgramListPagination } from './program-list-pagination';
import { ProgramListStatusChips } from './program-list-status-nav';
import type {
  ProgramListItem,
  ProgramListPage as ProgramListPageData,
  ProgramListStatus,
  ViewerRole,
} from './types';
import {
  PROGRAM_CATEGORY_LABELS,
  PROGRAM_LIST_STATUSES,
  programListHref,
} from './types';

interface ProgramListPageProps {
  readonly canCreateProgram: boolean;
  /** 부제 문구를 가른다(교직원/관리자 vs 그 외). */
  readonly viewerRole: ViewerRole;
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly programPage: ProgramListPageData }
  | { readonly kind: 'error'; readonly message: string };

const PAGE_SIZE = 20;

function formatApplicationPeriod(program: ProgramListItem): string {
  const formatter = new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'Asia/Seoul',
  });
  return `${formatter.format(new Date(program.applicationStartAt))} ~ ${formatter.format(new Date(program.applicationEndAt))}`;
}

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
function ProgramListPage({
  canCreateProgram,
  viewerRole,
}: ProgramListPageProps) {
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
            const badge = getProgramListBadge(program, now);
            // ended만 열람 불가 — ProgramCard 내부적으로도 status==='ended'면
            // href를 넘겨도 열리지 않지만, 애초에 넘기지 않는다.
            const isOpenable = badge.status !== 'ended';
            return (
              <ProgramCard
                badgeText={badge.label}
                category={`${program.organizer} · ${PROGRAM_CATEGORY_LABELS[program.category]}`}
                href={isOpenable ? programHref(program.id) : undefined}
                key={program.id}
                note={program.note?.text}
                noteIcon={program.note?.icon}
                period={formatApplicationPeriod(program)}
                status={badge.status}
                title={program.name}
              />
            );
          })}
        </CardGrid>
      </section>
    ));
  })();

  return (
    <section className="grid gap-6 p-4 sm:p-6">
      <PageHeader
        title={getProgramListHeading(status)}
        description={getProgramListSubtitle(viewerRole)}
        descriptionClassName="break-keep"
        actions={
          canCreateProgram ? (
            <Button asChild>
              <Link href={programNewHref()}>프로그램 만들기</Link>
            </Button>
          ) : undefined
        }
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
