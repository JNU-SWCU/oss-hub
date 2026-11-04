'use client';

import Link from 'next/link';
import { useCallback, useMemo, type ReactNode } from 'react';
import { useDebouncedUrlSearch } from '@/lib/list-url-state';
import { useProgramListQuery, useProgramEndedYearsQuery } from './list-queries';
import { CardGrid, EmptyState, FailureState, PageHeader } from '@/components';
import { ProgramCard, ProgramCardSkeleton } from './program-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ApiError } from '@/lib/api-client';
import { useNavigationNotices } from '@/lib/navigation-notices';
import { programNewHref } from '@/lib/program-route';
import { programHref } from '../program-paths';
import {
  getProgramListBadge,
  getProgramListHeading,
  getProgramListSubtitle,
} from './program-list';
import {
  parseProgramListYear,
  useProgramListUrlState,
} from './program-list-url-state';
import { ProgramListPagination } from './program-list-pagination';
import { PROGRAM_TRACK_TYPE_LABELS } from '../program-contract';
import type {
  ProgramListItem,
  ProgramListPage as ProgramListPageData,
} from './dto';
import type { ProgramListSort } from './program-list-options';
import type { ViewerRole } from '../program-contract';
import { PROGRAM_LIST_SORT_LABELS } from './program-list-labels';
import { PROGRAM_LIST_SORTS } from './program-list-options';

interface ProgramListPageProps {
  readonly canCreateProgram: boolean;

  readonly viewerRole: ViewerRole;

  readonly filters?: ReactNode;
}

type LoadState =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly programPage: ProgramListPageData;
    }
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

function ProgramListPage({
  canCreateProgram,
  viewerRole,
  filters,
}: ProgramListPageProps) {
  const { state: urlState, navigate } = useProgramListUrlState();
  const { status, sort, direction, year, search, page } = urlState;
  const replaceSearch = useCallback(
    (value: string) => navigate({ search: value, page: 1 }, 'replace'),
    [navigate],
  );
  const [searchInput, setSearchInput] = useDebouncedUrlSearch(
    search,
    replaceSearch,
  );
  const notices = useNavigationNotices();
  const purgeNotice = notices.status === 'ready' ? notices.purgeSummary : null;
  const ended = status === 'ended';
  const yearsQuery = useProgramEndedYearsQuery(ended);
  const years = yearsQuery.data ?? [];
  const yearOptions =
    year !== undefined && !years.includes(year) ? [year, ...years] : years;
  const listQuery = useProgramListQuery({
    page,
    pageSize: PAGE_SIZE,
    search,
    status: status === 'all' ? 'current' : status,
    sort,
    direction,
    year,
  });
  const loadState: LoadState = listQuery.isPending
    ? { kind: 'loading' }
    : listQuery.isError
      ? {
          kind: 'error',
          message:
            listQuery.error instanceof ApiError
              ? listQuery.error.message
              : '프로그램 목록을 불러오지 못했습니다.',
        }
      : { kind: 'ready', programPage: listQuery.data };
  const hasFilters =
    search !== '' ||
    year !== undefined ||
    (status !== 'all' && status !== 'ended');
  const now = useMemo(() => new Date(), []);

  const goSort = (nextSort: ProgramListSort | undefined) =>
    navigate(
      { sort: nextSort, direction: nextSort ? direction : undefined, page: 1 },
      'replace',
    );

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
          onRetry={() => void listQuery.refetch()}
        />
      );
    }
    if (loadState.programPage.items.length === 0) {
      return (
        <EmptyState
          title={
            hasFilters
              ? '조건에 맞는 프로그램이 없습니다'
              : status === 'ended'
                ? '종료된 프로그램이 없습니다'
                : '등록된 프로그램이 없습니다'
          }
          description={
            hasFilters
              ? '검색어나 프로그램 상태, 연도를 바꿔 다시 찾아보세요.'
              : status === 'ended'
                ? '프로그램이 종료되면 이곳에서 확인할 수 있습니다.'
                : '새 프로그램이 등록되면 이곳에서 확인할 수 있습니다.'
          }
          action={
            year !== undefined ? (
              <Button
                variant="outline"
                onClick={() => navigate({ year: undefined, page: 1 })}
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
        title={getProgramListHeading(status)}
        description={
          status === 'ended' ? undefined : getProgramListSubtitle(viewerRole)
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
      {purgeNotice ? (
        <Alert>
          <AlertTitle>프로그램 전체 삭제를 완료했습니다</AlertTitle>
          <AlertDescription>{purgeNotice}</AlertDescription>
        </Alert>
      ) : null}

      {filters}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        {ended && yearOptions.length > 0 ? (
          <label className="grid gap-1 text-sm">
            <span className="text-muted-foreground">종료 연도</span>
            <Select
              aria-label="종료 연도"
              value={year ?? ''}
              onChange={(event) =>
                navigate({
                  year: parseProgramListYear(event.target.value),
                  page: 1,
                })
              }
            >
              <option value="">전체 연도</option>
              {yearOptions.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <Input
          aria-label="프로그램명 검색"
          className="sm:flex-1 sm:min-w-48"
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="프로그램명 검색"
          value={searchInput}
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
        onPageChange={(nextPage) => navigate({ page: nextPage })}
        page={page}
        totalPages={
          loadState.kind === 'ready' ? loadState.programPage.totalPages : 0
        }
      />
    </section>
  );
}

export { ProgramListPage };
