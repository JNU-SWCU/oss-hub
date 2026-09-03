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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { ApiError } from '@/lib/api-client';
import { listPrograms } from './api';
import { programNewHref } from '@/lib/program-route';
import { programHref } from './program-paths';
import {
  getProgramListBadge,
  getProgramListHeading,
  getProgramListSubtitle,
} from './program-list';
import {
  buildProgramListHref,
  parseProgramListDirection,
  parseProgramListSort,
} from './program-list-sort';
import { ProgramListPagination } from './program-list-pagination';
import { ProgramListStatusChips } from './program-list-status-nav';
import { PROGRAM_TRACK_TYPE_LABELS } from './program-templates';
import type {
  ProgramListDirection,
  ProgramListItem,
  ProgramListPage as ProgramListPageData,
  ProgramListSort,
  ProgramListStatus,
  ViewerRole,
} from './types';
import {
  PROGRAM_CATEGORY_LABELS,
  PROGRAM_LIST_SORT_LABELS,
  PROGRAM_LIST_SORTS,
  PROGRAM_LIST_STATUSES,
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
  const sort = parseProgramListSort(searchParams.get('sort'));
  const direction = parseProgramListDirection(searchParams.get('direction'));
  const purgeNotice = searchParams.get('purged');

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
        sort,
        direction,
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
  }, [page, search, status, sort, direction]);

  useEffect(() => {
    void load();
    return () => {
      latestRequestId.current += 1;
    };
  }, [load]);

  // status·정렬 쿼리가 바뀌면 1페이지로
  useEffect(() => {
    setPage(1);
  }, [status, sort, direction]);

  const now = useMemo(() => new Date(), []);

  const goStatus = (next: ProgramListStatus) => {
    router.push(buildProgramListHref({ status: next, sort, direction }));
  };

  const goSort = (nextSort: ProgramListSort | undefined) => {
    router.push(
      buildProgramListHref({
        status,
        sort: nextSort,
        direction: nextSort ? direction : undefined,
      }),
    );
  };

  const goDirection = (nextDirection: ProgramListDirection) => {
    if (!sort) return;
    router.push(
      buildProgramListHref({ status, sort, direction: nextDirection }),
    );
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
    return (
      <CardGrid>
        {loadState.programPage.items.map((program) => {
          const badge = getProgramListBadge(program, now);
          // ended도 상세 열람은 허용된다(백엔드가 ARCHIVED 상세 읽기를
          // 이미 허용) — 모든 카드에 href를 넘긴다.
          return (
            <ProgramCard
              badgeText={badge.label}
              category={
                program.trackType === null
                  ? program.organizer
                  : `${program.organizer} · ${PROGRAM_TRACK_TYPE_LABELS[program.trackType]}`
              }
              href={programHref(program.id)}
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
    );
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
      {purgeNotice ? (
        <Alert>
          <AlertTitle>프로그램 전체 삭제를 완료했습니다</AlertTitle>
          <AlertDescription>{purgeNotice}</AlertDescription>
        </Alert>
      ) : null}
      {/* 좁은 폭: 전역 사이드가 가로 띠라 상태 칩을 본문에 한 번 더 둔다 */}
      <ProgramListStatusChips
        className="min-[900px]:hidden"
        value={status}
        onChange={goStatus}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <Input
          aria-label="프로그램명 검색"
          className="sm:flex-1 sm:min-w-48"
          onChange={(event) => {
            setPage(1);
            setSearch(event.target.value);
          }}
          placeholder="프로그램명 검색"
          value={search}
        />
        <label className="grid gap-1 text-sm">
          <span className="text-muted-foreground">정렬 기준</span>
          <Select
            aria-label="프로그램 정렬 기준"
            onChange={(event) => {
              const value = event.target.value;
              goSort(value === '' ? undefined : (value as ProgramListSort));
            }}
            value={sort ?? ''}
          >
            <option value="">기본순</option>
            {PROGRAM_LIST_SORTS.map((option) => (
              <option key={option} value={option}>
                {PROGRAM_LIST_SORT_LABELS[option]}
              </option>
            ))}
          </Select>
        </label>
        <Button
          aria-label={
            direction === 'desc' ? '내림차순으로 정렬됨' : '오름차순으로 정렬됨'
          }
          aria-pressed={direction === 'desc'}
          disabled={!sort}
          onClick={() =>
            goDirection((direction ?? 'asc') === 'asc' ? 'desc' : 'asc')
          }
          type="button"
          variant="outline"
        >
          {direction === 'desc' ? '내림차순' : '오름차순'}
        </Button>
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
