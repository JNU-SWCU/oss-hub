'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CardGrid,
  EmptyState,
  FailureState,
  FilterChip,
  FilterChipGroup,
  PageHeader,
} from '@/components';
import { ProgramCard, ProgramCardSkeleton } from './program-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { listPrograms } from './api';
import { programNewHref } from '@/lib/program-route';
import { programHref } from '../program-paths';
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
import { PROGRAM_TRACK_TYPE_LABELS } from '../program-contract';
import type {
  ProgramListItem,
  ProgramListPage as ProgramListPageData,
} from './dto';
import type {
  ProgramListSort,
  ProgramListStatus,
} from './program-list-options';
import type { ViewerRole } from '../program-contract';
import { PROGRAM_LIST_SORT_LABELS } from './program-list-labels';
import {
  archiveListHref,
  parseProgramArchiveFilter,
} from './program-archive-filter';
import {
  PROGRAM_LIST_SORTS,
  CURRENT_PROGRAM_LIST_STATUSES,
} from './program-list-options';

interface ProgramListPageProps {
  readonly canCreateProgram: boolean;

  readonly viewerRole: ViewerRole;
  readonly archiveYears?: readonly number[];
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
    (CURRENT_PROGRAM_LIST_STATUSES as readonly string[]).includes(value)
  ) {
    return value as ProgramListStatus;
  }
  return 'all';
}

function ProgramListPage({
  canCreateProgram,
  viewerRole,
  archiveYears,
}: ProgramListPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const status = parseStatus(searchParams.get('status'));
  const sort = parseProgramListSort(searchParams.get('sort'));
  const direction = parseProgramListDirection(searchParams.get('direction'));
  const purgeNotice = searchParams.get('purged');
  const archive = archiveYears !== undefined;
  const yearFilter = parseProgramArchiveFilter(searchParams.get('year'));
  const year = archive && yearFilter !== 'all' ? yearFilter : undefined;

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const latestRequestId = useRef(0);
  const hasFilters =
    search.trim() !== '' || (archive ? year !== undefined : status !== 'all');

  const load = useCallback(async (): Promise<void> => {
    const requestId = latestRequestId.current + 1;
    latestRequestId.current = requestId;
    setLoadState({ kind: 'loading' });
    try {
      const programPage = await listPrograms({
        page,
        pageSize: PAGE_SIZE,
        search,
        status: archive ? 'ended' : status === 'all' ? 'current' : status,
        sort,
        direction,
        year,
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
  }, [page, search, status, sort, direction, archive, year]);

  useEffect(() => {
    void load();
    return () => {
      latestRequestId.current += 1;
    };
  }, [load]);

  useEffect(() => {
    setPage(1);
  }, [status, sort, direction, year]);

  const now = useMemo(() => new Date(), []);

  const goStatus = (next: ProgramListStatus) => {
    router.push(buildProgramListHref({ status: next, sort, direction }));
  };

  const goSort = (nextSort: ProgramListSort | undefined) => {
    if (archive) {
      const params = new URLSearchParams();
      if (year !== undefined) params.set('year', String(year));
      if (nextSort) {
        params.set('sort', nextSort);
        if (direction) params.set('direction', direction);
      }
      router.push(`/archive${params.size ? `?${params.toString()}` : ''}`);
      return;
    }
    router.push(
      buildProgramListHref({
        status,
        sort: nextSort,
        direction: nextSort ? direction : undefined,
      }),
    );
  };

  const content = (() => {
    if (loadState.kind === 'loading') {
      return (
        <Skeleton label="프로그램 목록을 불러오는 중">
          <CardGrid>
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <ProgramCardSkeleton key={index} />
            ))}
          </CardGrid>
        </Skeleton>
      );
    }
    if (loadState.kind === 'error') {
      return (
        <FailureState
          title="프로그램 목록을 불러오지 못했습니다"
          description={loadState.message}
          onRetry={() => void load()}
        />
      );
    }
    if (loadState.programPage.items.length === 0) {
      return (
        <EmptyState
          title={
            hasFilters
              ? '조건에 맞는 프로그램이 없습니다'
              : archive
                ? '종료된 프로그램이 없습니다'
                : '등록된 프로그램이 없습니다'
          }
          description={
            hasFilters
              ? archive
                ? '검색어나 연도를 바꿔 다시 찾아보세요.'
                : '검색어나 프로그램 상태를 바꿔 다시 찾아보세요.'
              : archive
                ? '프로그램이 종료되면 이곳에서 확인할 수 있습니다.'
                : '새 프로그램이 등록되면 이곳에서 확인할 수 있습니다.'
          }
          action={
            archive && year !== undefined ? (
              <Button
                variant="outline"
                onClick={() => router.push(archiveListHref('all'))}
              >
                필터 초기화
              </Button>
            ) : undefined
          }
        />
      );
    }
    return (
      <CardGrid>
        {loadState.programPage.items.map((program) => {
          const badge = getProgramListBadge(program, now);

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
              coverImageUrl={program.coverImageUrl}
            />
          );
        })}
      </CardGrid>
    );
  })();

  return (
    <section className="mx-auto w-full max-w-[1200px] grid gap-6 p-4 sm:p-6">
      <PageHeader
        title={archive ? '공개 아카이브' : getProgramListHeading(status)}
        description={
          archive
            ? '종료된 프로그램을 모아 봅니다.'
            : getProgramListSubtitle(viewerRole)
        }
        descriptionClassName="break-keep"
        actions={
          canCreateProgram ? (
            <Button asChild>
              <Link href={programNewHref()}>프로그램 만들기</Link>
            </Button>
          ) : undefined
        }
      />
      {!archive && purgeNotice ? (
        <Alert>
          <AlertTitle>프로그램 전체 삭제를 완료했습니다</AlertTitle>
          <AlertDescription>{purgeNotice}</AlertDescription>
        </Alert>
      ) : null}

      {archive ? (
        <FilterChipGroup
          data-slot="archive-list-year-chips"
          aria-label="연도 필터"
          className="min-[900px]:hidden"
        >
          {(['all', ...archiveYears] as const).map((filter) => (
            <FilterChip
              key={filter}
              pressed={yearFilter === filter}
              onClick={() => router.push(archiveListHref(filter))}
            >
              {filter === 'all' ? '전체' : filter}
            </FilterChip>
          ))}
        </FilterChipGroup>
      ) : (
        <ProgramListStatusChips
          className="min-[900px]:hidden"
          value={status}
          onChange={goStatus}
        />
      )}
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
