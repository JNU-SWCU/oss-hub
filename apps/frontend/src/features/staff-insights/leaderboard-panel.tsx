'use client';

import { ArrowDown, ArrowUp, TrendingUp } from 'lucide-react';
import { useCallback, type ReactElement, type ReactNode } from 'react';
import {
  DataTable,
  EmptyState,
  FailureState,
  type DataTableColumn,
} from '@/components';
import { PaginationNav } from '@/components/pagination-nav';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { useDebouncedUrlSearch } from '@/lib/list-url-state';
import { cn } from '@/lib/utils';
import { FilterField, MetricHint } from './insights-controls';
import { KpiTile } from './kpi-tile';
import { DEPARTMENT_COHORTS, type StaffInsightsSummary } from './types';

const NO_VALUE = '—';
const NO_DEPARTMENT = '학과 미등록';
const HEAD = 'px-3 sm:px-4';
const CELL = 'px-3 py-3 sm:px-4';
const NUMBER_HEAD = `${HEAD} text-right`;
const NUMBER_CELL = `${CELL} text-right tabular-nums`;

const TOTAL_HINT =
  '선택한 기간의 공개 활동 합계입니다. 커밋, PR, 이슈, 저장소, 스타를 포함합니다.';
const RECENT_HINT =
  '선택한 기간과 별도로 집계한 최근 30일간 공개 활동 증가분입니다. 스타는 제외합니다.';
const COLLABORATION_HINT =
  '(PR + 이슈) ÷ 전체 활동. 커밋 외 협업 활동의 비중입니다.';
const RANK_CHANGE_HINT =
  '직전 연도 순위와 비교합니다. 비교할 연도에 순위가 없으면 신규로 표시합니다.';

type FinderSort =
  'name' | 'studentId' | 'total' | 'recentTotal' | 'collaborationRatio';

export type StaffInsightsFinderQuery = {
  readonly search: string;
  readonly department: string;
  readonly programId: string;
  readonly minActivity: number;
  readonly recentActivity: 'all' | 'active' | 'inactive';
  readonly sort: FinderSort;
  readonly direction: 'asc' | 'desc';
  readonly page: number;
};

type FinderRow = {
  readonly name: string | null;
  readonly githubLogin: string;
  readonly studentId: string | null;
  readonly major: string | null;
  readonly total: number;
  readonly recentTotal: number | null;
  readonly collaborationRatio: number | null;
  readonly programIds: readonly string[];
};

export type StaffInsightsFinderData = {
  readonly rows: readonly FinderRow[];
  readonly page: number;
  readonly pageSize: number;
  readonly total: number;
};

export type StaffInsightsFinderProps = {
  readonly query: StaffInsightsFinderQuery;
  readonly onQueryChange: (query: StaffInsightsFinderQuery) => void;
  readonly result:
    | { readonly kind: 'loading' }
    | {
        readonly kind: 'error';
        readonly message: string;
        readonly onRetry: () => void;
      }
    | { readonly kind: 'ready'; readonly data: StaffInsightsFinderData };
};

function percent(ratio: number | null): string {
  return ratio === null ? NO_VALUE : `${Math.round(ratio * 100)}%`;
}

function MetricHeading({
  label,
  hint,
  children,
}: {
  readonly label: string;
  readonly hint: string;
  readonly children?: ReactNode;
}): ReactElement {
  return (
    <span className="inline-flex items-center gap-1">
      {children ?? label}
      <MetricHint label={label} description={hint} />
    </span>
  );
}

function StudentName({
  student,
}: {
  readonly student: Pick<FinderRow, 'name' | 'githubLogin'>;
}): ReactElement {
  const label = student.name ?? student.githubLogin;
  return (
    <a
      href={`https://github.com/${encodeURIComponent(student.githubLogin)}`}
      target="_blank"
      rel="noreferrer"
      aria-label={`${label}의 GitHub 프로필 (새 탭에서 열림)`}
      className="font-semibold text-primary underline-offset-4 hover:underline"
    >
      {label}
    </a>
  );
}

function StudentsKpis({
  summary,
}: {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  const students = summary.cohorts.reduce(
    (sum, row) => sum + row.studentCount,
    0,
  );
  const active = summary.cohorts.reduce(
    (sum, row) => sum + row.activeStudentCount,
    0,
  );
  return (
    <section
      aria-label="학생 지표"
      className="grid grid-cols-2 gap-4 sm:grid-cols-3"
    >
      <KpiTile
        compact
        label="활동 학생 비율"
        value={percent(students > 0 ? active / students : null)}
      />
      <KpiTile compact label="활동 0건 학생" value={`${students - active}명`} />
      <KpiTile
        compact
        label="이번 달 첫 기여 학생"
        value={
          summary.firstContributionCount === null
            ? NO_VALUE
            : `${summary.firstContributionCount}명`
        }
      />
    </section>
  );
}

type PeriodLeader = StaffInsightsSummary['leaders']['period']['all'][number];

function RankChange({
  student,
  hasPriorYear,
}: {
  readonly student: PeriodLeader;
  readonly hasPriorYear: boolean;
}): ReactElement {
  if (student.previousRank === null) {
    return (
      <span className="text-muted-foreground">
        {hasPriorYear ? '신규' : NO_VALUE}
      </span>
    );
  }
  const change = student.previousRank - student.rank;
  if (change === 0) return <span className="text-muted-foreground">유지</span>;
  const Icon = change > 0 ? ArrowUp : ArrowDown;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1',
        change > 0 && 'text-status-approved-fg',
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
      <span className="sr-only">{change > 0 ? '상승 ' : '하락 '}</span>
      {Math.abs(change)}
    </span>
  );
}

function RankingCard({
  summary,
}: {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  const rows = summary.leaders.period.all;
  const recentTop = new Set(
    summary.leaders.recent.all.map((student) => student.githubLogin),
  );
  const hasPriorYear =
    summary.scope.kind === 'calendar' &&
    summary.years.includes(summary.scope.year - 1);
  const columns: DataTableColumn<PeriodLeader>[] = [
    {
      id: 'rank',
      header: '순위',
      headClassName: NUMBER_HEAD,
      cellClassName: NUMBER_CELL,
      headProps: { 'aria-sort': 'ascending' },
      cell: (student) => student.rank,
    },
    {
      id: 'name',
      header: '이름',
      headClassName: HEAD,
      cellClassName: CELL,
      cell: (student) => (
        <span className="inline-flex items-center gap-2">
          <StudentName student={student} />
          {recentTop.has(student.githubLogin) ? (
            <span className="inline-flex items-center gap-1 text-xs text-status-approved-fg">
              <TrendingUp aria-hidden="true" className="size-3.5" />
              급상승
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: 'studentId',
      header: '학번',
      headClassName: HEAD,
      cellClassName: `${CELL} tabular-nums`,
      cell: (student) => student.studentId ?? NO_VALUE,
    },
    {
      id: 'department',
      header: '학과',
      headClassName: HEAD,
      cellClassName: CELL,
      cell: (student) => student.department ?? NO_DEPARTMENT,
    },
    {
      id: 'major',
      header: '전공',
      headClassName: HEAD,
      cellClassName: CELL,
      cell: (student) => student.major ?? NO_VALUE,
    },
    {
      id: 'total',
      header: <MetricHeading label="활동 합계" hint={TOTAL_HINT} />,
      headClassName: NUMBER_HEAD,
      cellClassName: `${NUMBER_CELL} font-semibold`,
      cell: (student) => student.total,
    },
    {
      id: 'recentTotal',
      header: <MetricHeading label="최근 30일 활동" hint={RECENT_HINT} />,
      headClassName: NUMBER_HEAD,
      cellClassName: NUMBER_CELL,
      cell: (student) => student.recentTotal ?? NO_VALUE,
    },
    {
      id: 'rankChange',
      header: <MetricHeading label="순위 변화" hint={RANK_CHANGE_HINT} />,
      headClassName: NUMBER_HEAD,
      cellClassName: NUMBER_CELL,
      cell: (student) => (
        <RankChange student={student} hasPriorYear={hasPriorYear} />
      ),
    },
    {
      id: 'collaborationRatio',
      header: <MetricHeading label="협업 비율" hint={COLLABORATION_HINT} />,
      headClassName: NUMBER_HEAD,
      cellClassName: NUMBER_CELL,
      cell: (student) => percent(student.collaborationRatio),
    },
  ];

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>학생 순위</CardTitle>
      </CardHeader>
      {rows.length === 0 ? (
        <CardContent>
          <EmptyState title="이 기간에 활동한 학생이 없습니다" />
        </CardContent>
      ) : (
        <DataTable
          columns={columns}
          data={[...rows]}
          rowKey={(student) => student.githubLogin}
          scrollRegionLabel="학생 순위 표"
        />
      )}
    </Card>
  );
}

type AttentionStudent = StaffInsightsSummary['attentionStudents'][number];

const lastActivityDate = new Intl.DateTimeFormat('ko-KR', {
  timeZone: 'Asia/Seoul',
});

const ATTENTION_COLUMNS: DataTableColumn<AttentionStudent>[] = [
  {
    id: 'name',
    header: '이름',
    headClassName: HEAD,
    cellClassName: CELL,
    cell: (student) => <StudentName student={student} />,
  },
  {
    id: 'studentId',
    header: '학번',
    headClassName: HEAD,
    cellClassName: `${CELL} tabular-nums`,
    cell: (student) => student.studentId ?? NO_VALUE,
  },
  {
    id: 'department',
    header: '학과',
    headClassName: HEAD,
    cellClassName: CELL,
    cell: (student) => student.department ?? NO_DEPARTMENT,
  },
  {
    id: 'total',
    header: <MetricHeading label="활동 합계" hint={TOTAL_HINT} />,
    headClassName: NUMBER_HEAD,
    cellClassName: NUMBER_CELL,
    cell: (student) => student.total,
  },
  {
    id: 'lastActiveAt',
    header: '마지막 활동',
    headClassName: HEAD,
    cellClassName: `${CELL} text-muted-foreground`,
    cell: ({ lastActiveAt }) =>
      lastActiveAt === null ? (
        NO_VALUE
      ) : (
        <time dateTime={lastActiveAt.toISOString()}>
          {lastActivityDate.format(lastActiveAt)}
        </time>
      ),
  },
];

function AttentionCard({
  rows,
}: {
  readonly rows: readonly AttentionStudent[];
}): ReactElement {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>관심 필요</CardTitle>
      </CardHeader>
      {rows.length === 0 ? (
        <CardContent>
          <EmptyState title="관심이 필요한 학생이 없습니다" />
        </CardContent>
      ) : (
        <DataTable
          columns={ATTENTION_COLUMNS}
          data={[...rows]}
          rowKey={(student) => student.githubLogin}
          scrollRegionLabel="관심 필요 학생 표"
        />
      )}
    </Card>
  );
}

export function StudentsTab({
  summary,
}: {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  return (
    <>
      <StudentsKpis summary={summary} />
      <RankingCard summary={summary} />
      <AttentionCard rows={summary.attentionStudents} />
    </>
  );
}

function FinderFilters({
  summary,
  query,
  onQueryChange,
}: Pick<StaffInsightsFinderProps, 'query' | 'onQueryChange'> & {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  const changeSearch = useCallback(
    (search: string) => {
      onQueryChange({ ...query, search, page: 1 });
    },
    [query, onQueryChange],
  );
  const [search, setSearch] = useDebouncedUrlSearch(query.search, changeSearch);
  const departments = [
    ...new Set(
      summary.departments
        .filter((row) => row.cohort !== DEPARTMENT_COHORTS.UNREGISTERED)
        .map((row) => row.department),
    ),
  ].sort((a, b) => a.localeCompare(b, 'ko'));

  function update(filters: Partial<StaffInsightsFinderQuery>): void {
    onQueryChange({ ...query, search: search.trim(), ...filters, page: 1 });
  }

  return (
    <section
      aria-label="학생 찾기 필터"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
    >
      <FilterField id="finder-search" label="검색">
        <Input
          id="finder-search"
          type="search"
          autoComplete="off"
          value={search}
          placeholder="이름 · 학번 · GitHub 아이디"
          onChange={(event) => setSearch(event.currentTarget.value)}
        />
      </FilterField>
      <FilterField id="finder-department" label="학과">
        <Select
          id="finder-department"
          value={query.department}
          onChange={(event) =>
            update({ department: event.currentTarget.value })
          }
        >
          <option value="">전체</option>
          {departments.map((department) => (
            <option key={department}>{department}</option>
          ))}
        </Select>
      </FilterField>
      <FilterField id="finder-program" label="프로그램 참여">
        <Select
          id="finder-program"
          value={query.programId}
          onChange={(event) => update({ programId: event.currentTarget.value })}
        >
          <option value="">전체</option>
          {summary.programs.map((program) => (
            <option key={program.programId} value={program.programId}>
              {program.name}
            </option>
          ))}
        </Select>
      </FilterField>
      <FilterField id="finder-min-activity" label="최소 활동량">
        <Select
          id="finder-min-activity"
          value={query.minActivity}
          onChange={(event) =>
            update({ minActivity: Number(event.currentTarget.value) })
          }
        >
          <option value={0}>전체</option>
          {[50, 200, 500].map((count) => (
            <option key={count} value={count}>{`${count}건 이상`}</option>
          ))}
        </Select>
      </FilterField>
      <FilterField id="finder-recent" label="최근 30일 활동">
        <Select
          id="finder-recent"
          value={query.recentActivity}
          onChange={(event) => {
            const value = event.currentTarget.value;
            if (value === 'all' || value === 'active' || value === 'inactive')
              update({ recentActivity: value });
          }}
        >
          <option value="all">전체</option>
          <option value="active">활동</option>
          <option value="inactive">미활동</option>
        </Select>
      </FilterField>
    </section>
  );
}

function finderColumns(
  programs: StaffInsightsSummary['programs'],
  query: StaffInsightsFinderQuery,
  onQueryChange: StaffInsightsFinderProps['onQueryChange'],
): DataTableColumn<FinderRow>[] {
  const programNames = new Map(
    programs.map((program) => [program.programId, program.name]),
  );

  function sortable(
    sort: FinderSort,
    label: string,
    hint?: string,
  ): Pick<DataTableColumn<FinderRow>, 'header' | 'headProps'> {
    const selected = query.sort === sort;
    const direction = selected
      ? query.direction === 'asc'
        ? 'desc'
        : 'asc'
      : sort === 'name' || sort === 'studentId'
        ? 'asc'
        : 'desc';
    const Icon = query.direction === 'asc' ? ArrowUp : ArrowDown;
    const trigger = (
      <Button
        type="button"
        variant="bare"
        size="content"
        className="inline-flex items-center gap-1 whitespace-nowrap hover:text-foreground"
        aria-label={`${label} ${direction === 'asc' ? '오름차순' : '내림차순'} 정렬`}
        onClick={() => onQueryChange({ ...query, sort, direction, page: 1 })}
      >
        {label}
        {selected ? <Icon aria-hidden="true" className="size-3" /> : null}
      </Button>
    );
    return {
      header:
        hint === undefined ? (
          trigger
        ) : (
          <MetricHeading label={label} hint={hint}>
            {trigger}
          </MetricHeading>
        ),
      headProps: selected
        ? {
            'aria-sort': query.direction === 'asc' ? 'ascending' : 'descending',
          }
        : undefined,
    };
  }

  return [
    {
      id: 'name',
      ...sortable('name', '이름'),
      headClassName: HEAD,
      cellClassName: CELL,
      cell: (student) => <StudentName student={student} />,
    },
    {
      id: 'studentId',
      ...sortable('studentId', '학번'),
      headClassName: HEAD,
      cellClassName: `${CELL} tabular-nums`,
      cell: (student) => student.studentId ?? NO_VALUE,
    },
    {
      id: 'major',
      header: '전공',
      headClassName: HEAD,
      cellClassName: CELL,
      cell: (student) => student.major ?? NO_VALUE,
    },
    {
      id: 'total',
      ...sortable('total', '활동 합계', TOTAL_HINT),
      headClassName: NUMBER_HEAD,
      cellClassName: `${NUMBER_CELL} font-semibold`,
      cell: (student) => student.total,
    },
    {
      id: 'recentTotal',
      ...sortable('recentTotal', '최근 30일 활동', RECENT_HINT),
      headClassName: NUMBER_HEAD,
      cellClassName: NUMBER_CELL,
      cell: (student) => student.recentTotal ?? NO_VALUE,
    },
    {
      id: 'collaborationRatio',
      ...sortable('collaborationRatio', '협업 비율', COLLABORATION_HINT),
      headClassName: NUMBER_HEAD,
      cellClassName: NUMBER_CELL,
      cell: (student) => percent(student.collaborationRatio),
    },
    {
      id: 'programs',
      header: '참여 프로그램',
      headClassName: HEAD,
      cellClassName: `${CELL} max-w-52 break-keep whitespace-normal`,
      cell: (student) =>
        student.programIds
          .flatMap((id) => programNames.get(id) ?? [])
          .join(' · ') || NO_VALUE,
    },
  ];
}

export function FinderTab({
  summary,
  query,
  result,
  onQueryChange,
}: StaffInsightsFinderProps & {
  readonly summary: StaffInsightsSummary;
}): ReactElement {
  const data = result.kind === 'ready' ? result.data : null;
  return (
    <>
      <FinderFilters
        summary={summary}
        query={query}
        onQueryChange={onQueryChange}
      />
      <Card className="min-w-0" aria-busy={result.kind === 'loading'}>
        <CardHeader>
          <CardTitle aria-live="polite">
            {data === null ? '검색 결과' : `검색 결과 ${data.total}명`}
          </CardTitle>
        </CardHeader>
        {result.kind === 'error' ? (
          <CardContent>
            <FailureState
              title="학생을 불러오지 못했습니다"
              description={result.message}
              onRetry={result.onRetry}
            />
          </CardContent>
        ) : (
          <DataTable
            columns={finderColumns(summary.programs, query, onQueryChange)}
            data={data === null ? [] : [...data.rows]}
            rowKey={(student) => student.githubLogin}
            scrollRegionLabel="학생 검색 결과 표"
            isLoading={result.kind === 'loading'}
            emptyState="조건에 맞는 학생이 없습니다"
          />
        )}
        {data === null ? null : (
          <PaginationNav
            page={data.page}
            totalPages={Math.max(1, Math.ceil(data.total / data.pageSize))}
            onPageChange={(page) => onQueryChange({ ...query, page })}
            ariaLabel="학생 검색 결과 페이지"
          />
        )}
      </Card>
    </>
  );
}
