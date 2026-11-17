import Link from 'next/link';
import type { ReactElement, ReactNode } from 'react';
import { DataTable, EmptyState, type DataTableColumn } from '@/components';
import { Button } from '@/components/ui/button';
import { programEditHref } from '@/lib/program-route';
import {
  applyMatrixQuickFilter,
  cellForMilestone,
  formatMatrixDueDate,
  isMilestoneWithoutRequiredItems,
  MATRIX_MODE_LABELS,
  matrixEmptyKind,
  matrixRowTitle,
  matrixTotalPages,
} from '../matrix';
import type { MatrixMilestone, MatrixRow } from '../types';
import { MatrixCellContent } from './submission-matrix-cell';
import {
  MatrixPagination,
  MatrixQuickFilterButtons,
  MatrixSkeleton,
  MatrixStatsStrip,
} from './submission-matrix-controls';
import type { SubmissionMatrixViewProps } from './submission-matrix-view';

const TABLE_CARD = 'min-w-0 overflow-hidden rounded-card border border-border';

function matrixColumns(
  programId: string,
  milestones: readonly MatrixMilestone[],
  now: Date,
  focused: boolean,
): DataTableColumn<MatrixRow>[] {
  return [
    {
      id: 'application',
      header: '신청',
      headClassName: 'sticky left-0 z-10 min-w-48 bg-background',
      cellClassName: 'sticky left-0 z-10 min-w-48 bg-background',
      cell: (row) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">
            {matrixRowTitle(row)}
            {row.applicationMode === 'PERSONAL'
              ? ` · ${MATRIX_MODE_LABELS.PERSONAL}`
              : null}
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
          programId={programId}
          cell={cellForMilestone(row, milestone.id)}
          milestone={milestone}
          now={now}
          focused={focused}
        />
      ),
    })),
  ];
}

function MatrixEmptyState(props: SubmissionMatrixViewProps): ReactNode {
  if (props.data === null) return null;
  const empty = matrixEmptyKind({
    milestoneCount: props.data.milestones.length,
    rowCount: props.data.rows.length,
    filterActive: props.filterActive,
  });

  if (empty === 'no-milestones') {
    return (
      <EmptyState
        title="마일스톤이 없습니다"
        description="프로그램에 마일스톤을 추가하면 제출 현황을 조회할 수 있습니다."
        action={
          <Button asChild variant="outline">
            <Link href={programEditHref(props.programId)}>마일스톤 추가</Link>
          </Button>
        }
      />
    );
  }
  if (empty === 'no-applications') {
    return (
      <EmptyState
        className="break-keep"
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
  return null;
}

export function MatrixBody(
  props: SubmissionMatrixViewProps,
): ReactElement | null {
  if (props.isLoading) return <MatrixSkeleton />;
  if (props.data === null) return null;

  const emptyState = MatrixEmptyState(props);
  if (emptyState !== null) return <>{emptyState}</>;

  const { milestones, rows, page, pageSize, total } = props.data;
  const selectedMilestone =
    milestones.find((item) => item.id === props.selectedMilestoneId) ?? null;
  const visibleMilestones = selectedMilestone
    ? [selectedMilestone]
    : milestones;
  const noRequiredItems =
    selectedMilestone !== null &&
    isMilestoneWithoutRequiredItems(rows, selectedMilestone, props.now);
  const quickFiltered = noRequiredItems
    ? rows
    : applyMatrixQuickFilter(
        rows,
        visibleMilestones,
        props.quickFilter,
        props.now,
      );

  return (
    <>
      {selectedMilestone === null ? (
        <MatrixStatsStrip rows={rows} milestones={milestones} now={props.now} />
      ) : null}
      {noRequiredItems ? null : (
        <MatrixQuickFilterButtons
          rows={rows}
          visibleMilestones={visibleMilestones}
          now={props.now}
          quickFilter={props.quickFilter}
          onQuickFilterChange={props.onQuickFilterChange}
        />
      )}
      {total > rows.length || selectedMilestone === null ? (
        <p id="matrix-scroll-hint" className="text-small text-muted-foreground">
          {total > rows.length
            ? `전체 ${total}개 팀 중 ${rows.length}개를 표시합니다. 빠른 필터는 이 페이지에만 적용됩니다.`
            : null}
          {total > rows.length && selectedMilestone === null ? ' ' : null}
          {selectedMilestone === null
            ? '표를 좌우로 스크롤할 수 있습니다.'
            : null}
        </p>
      ) : null}
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
          aria-describedby={
            total > rows.length || selectedMilestone === null
              ? 'matrix-scroll-hint'
              : undefined
          }
          scrollRegionLabel="마일스톤 제출 현황 표"
          columns={matrixColumns(
            props.programId,
            visibleMilestones,
            props.now,
            selectedMilestone !== null,
          )}
          data={[...quickFiltered]}
          rowKey={(row) => row.teamId}
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
