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
  applyMatrixQuickFilter,
  cellForMilestone,
  formatMatrixDueDate,
  formatSubmittedAt,
  isLateSubmission,
  MATRIX_MODE_LABELS,
  MATRIX_STATUS_LABELS,
  MATRIX_STATUS_VARIANTS,
  matrixEmptyKind,
  matrixPageStats,
  matrixRowHasEmptyCell,
  matrixRowIsZeroSubmission,
  matrixRowTitle,
  matrixTotalPages,
  notSubmittedDeadline,
  type MatrixQuickFilter,
} from '../matrix';
import { programEditHref } from '@/lib/program-route';
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
  'grid w-full min-w-0 gap-4 sm:grid-cols-2 xl:grid-cols-3 xl:items-end';

export interface SubmissionMatrixViewProps {
  readonly programId: string;
  readonly data: SubmissionMatrixPage | null;
  readonly search: string;
  readonly filterActive: boolean;
  /** #619 스펙 3버튼 빠른 필터 — 서버 재조회 없이 로드된 페이지 행만 거른다. */
  readonly quickFilter: MatrixQuickFilter;
  readonly isLoading: boolean;
  readonly errorMessage: string | null;
  readonly now: Date;
  readonly onSearchChange: (value: string) => void;
  readonly onSearch: () => void;
  readonly onQuickFilterChange: (filter: MatrixQuickFilter) => void;
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
  // 제출 시각 + 지각 여부(dueAt 이후 제출) — #619 스펙("지각" 배지 + 제출 일시).
  const late = isLateSubmission(cell, milestone);
  const meta = (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap items-center gap-1">
        {badge}
        {late ? <StatusBadge variant="pending">지각</StatusBadge> : null}
      </span>
      {cell.submittedAt !== null ? (
        <span className="text-small text-muted-foreground">
          {formatSubmittedAt(cell.submittedAt)}
        </span>
      ) : null}
      {cell.revision !== null ? (
        <span className="text-small text-muted-foreground">
          v{cell.revision}
        </span>
      ) : null}
    </span>
  );
  if (cell.reviewUrl === null) return meta;
  return (
    <Link
      href={cell.reviewUrl}
      aria-label={`${milestone.name} 제출물 검토`}
      className="inline-flex flex-col items-start gap-1 hover:opacity-80"
    >
      {meta}
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

/**
 * 서류 칸 요약 — #619 스펙의 4칸 통계를 현재 페이지에 로드된 행 기준으로 낸다.
 * "전체 47팀" 같은 전수 집계는 페이지네이션 때문에 이 화면만으로 낼 수 없어
 * "이 페이지" 표기를 붙인다(matrix.ts matrixPageStats 주석 참고).
 */
function MatrixStatsStrip({
  rows,
  milestones,
}: {
  readonly rows: readonly MatrixRow[];
  readonly milestones: readonly MatrixMilestone[];
}): ReactElement {
  const stats = matrixPageStats(rows, milestones);
  const facts: { readonly label: string; readonly value: string }[] = [
    {
      label: '서류 칸',
      value: `${stats.filledCells}/${stats.totalCells} 채움`,
    },
    { label: '빈 칸', value: `${stats.emptyCells}개` },
    { label: '한 장도 안 낸 팀', value: `${stats.zeroSubmissionRows}팀` },
    { label: '지각 제출', value: `${stats.lateCells}건` },
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-3 rounded-card border border-border p-card sm:grid-cols-4">
      {facts.map((fact) => (
        <div key={fact.label} className="flex flex-col gap-1">
          <dt className="text-small text-muted-foreground">{fact.label}</dt>
          <dd className="text-lg font-semibold">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const QUICK_FILTER_BUTTON_BASE =
  'h-control rounded-control px-4 text-small font-semibold transition-colors';

/**
 * 3버튼 빠른 필터(#619 스펙) — "전체 N팀"/"빈 칸 있는 팀 N"/"한 장도 안 낸 팀 N".
 * 선택됨: secondary 배경 + foreground 텍스트 / 미선택: card 배경 + muted 텍스트.
 */
function MatrixQuickFilterButtons({
  rows,
  milestones,
  quickFilter,
  onQuickFilterChange,
}: {
  readonly rows: readonly MatrixRow[];
  readonly milestones: readonly MatrixMilestone[];
  readonly quickFilter: MatrixQuickFilter;
  readonly onQuickFilterChange: (filter: MatrixQuickFilter) => void;
}): ReactElement {
  const hasEmptyCount = rows.filter((row) =>
    matrixRowHasEmptyCell(row, milestones),
  ).length;
  const zeroSubmissionCount = rows.filter((row) =>
    matrixRowIsZeroSubmission(row, milestones),
  ).length;
  const options: {
    readonly value: MatrixQuickFilter;
    readonly label: string;
  }[] = [
    { value: 'ALL', label: `전체 ${rows.length}팀` },
    { value: 'HAS_EMPTY', label: `빈 칸 있는 팀 ${hasEmptyCount}` },
    {
      value: 'ZERO_SUBMISSION',
      label: `한 장도 안 낸 팀 ${zeroSubmissionCount}`,
    },
  ];
  return (
    <div role="group" aria-label="빠른 필터" className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={quickFilter === option.value}
          className={
            quickFilter === option.value
              ? `${QUICK_FILTER_BUTTON_BASE} bg-secondary text-foreground`
              : `${QUICK_FILTER_BUTTON_BASE} bg-card text-muted-foreground border border-border`
          }
          onClick={() => onQuickFilterChange(option.value)}
        >
          {option.label}
        </button>
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
            <Link href={programEditHref(props.programId)}>
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
        description="다른 검색어를 사용해 보세요."
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

  const quickFiltered = applyMatrixQuickFilter(
    rows,
    milestones,
    props.quickFilter,
  );

  return (
    <>
      <MatrixStatsStrip rows={rows} milestones={milestones} />
      <MatrixQuickFilterButtons
        rows={rows}
        milestones={milestones}
        quickFilter={props.quickFilter}
        onQuickFilterChange={props.onQuickFilterChange}
      />
      <p id="matrix-scroll-hint" className="text-small text-muted-foreground">
        이 페이지 {rows.length}건(전체 {total}건) 중 {quickFiltered.length}건
        표시 · 표를 좌우로 스크롤할 수 있습니다.
      </p>
      {quickFiltered.length === 0 ? (
        <EmptyState
          title="조건에 맞는 팀이 없습니다"
          description="빠른 필터를 바꿔 다시 확인해 보세요."
          action={
            <Button
              type="button"
              variant="outline"
              onClick={() => props.onQuickFilterChange('ALL')}
            >
              전체 보기
            </Button>
          }
        />
      ) : (
        <DataTable
          className={TABLE_CARD}
          aria-describedby="matrix-scroll-hint"
          columns={columns}
          data={[...quickFiltered]}
          rowKey={(row) => row.applicationId}
        />
      )}
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
        title="서류 현황"
        description={
          <span className="break-keep">
            팀·개인별 마일스톤 제출 여부와 제출 시각을 확인합니다.
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
          <div className="flex w-full min-w-0 gap-2 sm:col-span-1">
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
