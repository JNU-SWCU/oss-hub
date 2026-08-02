import Link from 'next/link';
import type { FormEvent, ReactElement, ReactNode } from 'react';
import {
  DataTable,
  EmptyState,
  PageBody,
  PageHeader,
  StatusBadge,
  type DataTableColumn,
} from '@/components';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  cellForMilestone,
  formatMatrixDueDate,
  MATRIX_MODE_LABELS,
  MATRIX_STATUS_LABELS,
  MATRIX_STATUS_VARIANTS,
  matrixEmptyKind,
  matrixRowTitle,
  matrixTotalPages,
  notSubmittedDeadline,
  parseMatrixModeFilter,
  type MatrixModeFilter,
} from '../matrix';
import type {
  MatrixCell,
  MatrixMilestone,
  MatrixRow,
  SubmissionMatrixPage,
} from '../types';

const SECTION_BODY = 'flex min-w-0 flex-col gap-8';
const TABLE_CARD = 'min-w-0 overflow-hidden rounded-card border border-border';
/** 필터 줄 — 시안은 필터를 카드에 넣지 않는다. 표(카드)와 제목 사이의 조작 줄이다. */
const FILTER_ROW =
  'grid w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:items-end';
const SELECT_CONTROL =
  'h-control w-full min-w-0 rounded-control border border-input bg-background px-4 text-body outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50';

const MODE_FILTER_OPTIONS = [
  { value: 'ALL', label: '전체' },
  { value: 'PERSONAL', label: MATRIX_MODE_LABELS.PERSONAL },
  { value: 'TEAM', label: MATRIX_MODE_LABELS.TEAM },
] as const;

export interface SubmissionMatrixViewProps {
  readonly programId: string;
  readonly data: SubmissionMatrixPage | null;
  readonly search: string;
  readonly mode: MatrixModeFilter;
  readonly filterActive: boolean;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly now: Date;
  readonly onSearchChange: (value: string) => void;
  readonly onSearch: () => void;
  readonly onModeChange: (mode: MatrixModeFilter) => void;
  readonly onResetFilters: () => void;
  readonly onPageChange: (page: number) => void;
  readonly onRetry: () => void;
}

/**
 * 매트릭스 셀(#124) — 제출이 있는 셀만 백엔드가 준 reviewUrl(#125 검토 화면)로
 * 링크한다. NOT_SUBMITTED는 링크 없이 상태 + dueAt 파생 보조 표시(OVERDUE/D-n)만.
 */
function MatrixCellContent({
  cell,
  milestone,
  now,
}: {
  readonly cell: MatrixCell;
  readonly milestone: MatrixMilestone;
  readonly now: Date;
}): ReactElement {
  const badge = (
    <StatusBadge variant={MATRIX_STATUS_VARIANTS[cell.status]}>
      {MATRIX_STATUS_LABELS[cell.status]}
    </StatusBadge>
  );
  if (cell.status === 'NOT_SUBMITTED') {
    const deadline = notSubmittedDeadline(milestone.dueAt, now);
    return (
      <span className="flex flex-col items-start gap-1">
        {badge}
        <span
          className={
            deadline.overdue
              ? 'text-small font-semibold text-destructive'
              : 'text-small text-muted-foreground'
          }
        >
          {deadline.label}
        </span>
      </span>
    );
  }
  if (cell.reviewUrl === null) return badge;
  return (
    <Link
      href={cell.reviewUrl}
      aria-label={`${milestone.name} 제출물 검토`}
      className="inline-flex flex-col items-start gap-1 hover:opacity-80"
    >
      {badge}
      {cell.revision !== null ? (
        <span className="text-small text-muted-foreground">
          v{cell.revision}
        </span>
      ) : null}
    </Link>
  );
}

function MatrixPagination({
  page,
  totalPages,
  onPageChange,
}: {
  readonly page: number;
  readonly totalPages: number;
  readonly onPageChange: (page: number) => void;
}): ReactElement | null {
  if (totalPages <= 1) return null;
  return (
    <nav
      aria-label="제출 현황 페이지"
      className="flex items-center justify-center gap-3"
    >
      <Button
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        variant="outline"
      >
        이전
      </Button>
      <span className="text-small text-muted-foreground">
        {page} / {totalPages}
      </span>
      <Button
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        variant="outline"
      >
        다음
      </Button>
    </nav>
  );
}

function MatrixSkeleton(): ReactElement {
  return (
    <div
      aria-busy="true"
      aria-label="제출 현황을 불러오는 중"
      className="flex flex-col gap-3 rounded-card border border-border p-card"
    >
      <span className="bg-muted h-4 w-1/3 animate-pulse rounded" />
      {[0, 1, 2, 3].map((row) => (
        <span key={row} className="bg-muted h-3 w-full animate-pulse rounded" />
      ))}
    </div>
  );
}

function MatrixBody(props: SubmissionMatrixViewProps): ReactNode {
  if (props.isLoading) return <MatrixSkeleton />;
  if (props.data === null) return null;

  const { milestones, rows, page, pageSize, total } = props.data;
  const empty = matrixEmptyKind({
    milestoneCount: milestones.length,
    rowCount: rows.length,
    filterActive: props.filterActive,
  });

  if (empty === 'no-milestones') {
    return (
      <EmptyState
        title="마일스톤이 없습니다"
        description="프로그램에 마일스톤을 추가하면 제출 현황을 조회할 수 있습니다."
        action={
          <Button asChild variant="outline">
            <Link
              href={`/staff/programs/${encodeURIComponent(props.programId)}/edit`}
            >
              프로그램 편집에서 마일스톤 추가
            </Link>
          </Button>
        }
      />
    );
  }
  if (empty === 'no-applications') {
    return (
      <EmptyState
        title="참여 중인 신청이 없습니다"
        description="승인된 신청이 생기면 여기에 표시됩니다."
      />
    );
  }
  if (empty === 'no-results') {
    return (
      <EmptyState
        title="검색 결과가 없습니다"
        description="다른 검색어나 형태 필터를 사용해 보세요."
        action={
          <Button
            type="button"
            variant="outline"
            onClick={props.onResetFilters}
          >
            필터 초기화
          </Button>
        }
      />
    );
  }

  const columns: DataTableColumn<MatrixRow>[] = [
    {
      id: 'application',
      header: '신청',
      headClassName: 'sticky left-0 z-10 min-w-48 bg-background',
      cellClassName: 'sticky left-0 z-10 min-w-48 bg-background',
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">
            {matrixRowTitle(row)} · {MATRIX_MODE_LABELS[row.applicationMode]}
          </span>
          {row.githubLogins.length > 0 ? (
            <span className="text-small text-muted-foreground">
              {row.githubLogins.map((login) => `@${login}`).join(' ')}
            </span>
          ) : null}
        </span>
      ),
    },
    ...milestones.map((milestone): DataTableColumn<MatrixRow> => ({
      id: milestone.id,
      header: (
        <span className="flex flex-col gap-0.5">
          <span>{milestone.name}</span>
          <span className="text-small font-normal text-muted-foreground">
            {formatMatrixDueDate(milestone.dueAt)} 마감
          </span>
        </span>
      ),
      headClassName: 'min-w-32',
      cellClassName: 'min-w-32',
      cell: (row) => (
        <MatrixCellContent
          cell={cellForMilestone(row, milestone.id)}
          milestone={milestone}
          now={props.now}
        />
      ),
    })),
  ];

  return (
    <>
      <p id="matrix-scroll-hint" className="text-small text-muted-foreground">
        총 {total}건 · 표를 좌우로 스크롤할 수 있습니다.
      </p>
      <DataTable
        className={TABLE_CARD}
        aria-describedby="matrix-scroll-hint"
        columns={columns}
        data={[...rows]}
        rowKey={(row) => row.applicationId}
      />
      <MatrixPagination
        page={page}
        totalPages={matrixTotalPages(total, pageSize)}
        onPageChange={props.onPageChange}
      />
    </>
  );
}

export function SubmissionMatrixView(props: SubmissionMatrixViewProps) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    props.onSearch();
  };

  return (
    <PageBody>
      <PageHeader
        title="제출 현황"
        description={
          <span className="break-keep">
            승인된 신청의 마일스톤별 제출 상태를 조회합니다.
          </span>
        }
      />
      <div className={SECTION_BODY}>
        <form className={FILTER_ROW} onSubmit={submit}>
          <div className="flex w-full min-w-0 flex-col gap-2">
            <label htmlFor="matrix-search" className="text-small font-semibold">
              검색
            </label>
            <Input
              id="matrix-search"
              className="h-control w-full min-w-0"
              value={props.search}
              onChange={(event) => props.onSearchChange(event.target.value)}
              placeholder="신청자·팀명·GitHub ID"
            />
          </div>
          <div className="flex w-full min-w-0 flex-col gap-2">
            <label htmlFor="matrix-mode" className="text-small font-semibold">
              형태
            </label>
            <select
              id="matrix-mode"
              className={SELECT_CONTROL}
              value={props.mode}
              onChange={(event) =>
                props.onModeChange(parseMatrixModeFilter(event.target.value))
              }
            >
              {MODE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <div className="flex w-full min-w-0 gap-2 sm:col-span-2">
            {/* 이 화면의 주 행동은 조회 하나뿐이다 — 채운 버튼도 하나뿐이다.
                버튼은 글자만큼만 넓힌다. 좁은 화면에서만 한 줄을 반씩 나눠 갖는다. */}
            <Button type="submit" className="h-control flex-1 sm:flex-none">
              조회
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-control flex-1 sm:flex-none"
              onClick={props.onResetFilters}
            >
              초기화
            </Button>
          </div>
        </form>
        {props.errorMessage !== null ? (
          <Alert variant="destructive">
            <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span>{props.errorMessage}</span>
              <Button
                type="button"
                variant="outline"
                className="h-control"
                onClick={props.onRetry}
              >
                다시 시도
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}
        <MatrixBody {...props} />
      </div>
    </PageBody>
  );
}
