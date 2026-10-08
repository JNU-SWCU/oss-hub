import type { DocumentDeliveryStatus } from '@/lib/document-delivery';
import type {
  MatrixApplicationMode,
  MatrixCell,
  MatrixMilestone,
  MatrixRow,
} from './types';
export {
  formatMatrixDueDate,
  formatMatrixDueDateTime,
  formatSubmittedAt,
  notSubmittedDeadline,
  type NotSubmittedDeadline,
} from './matrix-format';

export const MATRIX_PAGE_SIZE = 20;

export interface MatrixQueryInput {
  readonly q: string;
  readonly page: number;
  readonly pageSize: number;
}

export const MATRIX_CELL_DISPLAY_LABELS = {
  NOT_SUBMITTED: '미제출',
  SUBMITTED: '검토 대기',
  LATE: '지각 제출',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 요청',
  REJECTED: '반려',
} as const;

export type MatrixCellDisplay = keyof typeof MATRIX_CELL_DISPLAY_LABELS;

export const MATRIX_CELL_DISPLAY_VARIANTS = {
  NOT_SUBMITTED: 'closed',
  SUBMITTED: 'recruiting',
  LATE: 'pending',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'pending',
  REJECTED: 'rejected',
} as const satisfies Readonly<
  Record<
    MatrixCellDisplay,
    'closed' | 'recruiting' | 'approved' | 'pending' | 'rejected'
  >
>;

export function matrixCellDisplay(cell: MatrixCell): MatrixCellDisplay {
  return cell.status;
}

export const MATRIX_MODE_LABELS = {
  PERSONAL: '개인',
  TEAM: '팀',
} as const satisfies Readonly<Record<MatrixApplicationMode, string>>;

export function buildMatrixSearchParams(
  input: MatrixQueryInput,
): URLSearchParams {
  const params = new URLSearchParams();
  const q = input.q.trim();
  if (q !== '') params.set('q', q);
  params.set('page', String(input.page));
  params.set('pageSize', String(input.pageSize));
  return params;
}

export function matrixTotalPages(total: number, pageSize: number): number {
  if (total <= 0 || pageSize <= 0) return 0;
  return Math.ceil(total / pageSize);
}

export function cellForMilestone(
  row: MatrixRow,
  milestoneId: string,
): MatrixCell {
  return (
    row.cells.find((cell) => cell.milestoneId === milestoneId) ?? {
      milestoneId,
      submissionId: null,
      revision: null,
      status: 'NOT_SUBMITTED',
      deliveryStatus: 'MISSING',
      submittedAt: null,
      reviewUrl: null,
    }
  );
}

export function matrixRowTitle(row: MatrixRow): string {
  if (row.applicationMode === 'TEAM') {
    return `${row.displayName}(${row.githubLogins.length})`;
  }
  return row.displayName;
}

export function isMatrixFilterActive(q: string): boolean {
  return q.trim() !== '';
}

export type MatrixEmptyKind =
  'no-milestones' | 'no-applications' | 'no-results' | null;

export function matrixEmptyKind(input: {
  readonly milestoneCount: number;
  readonly rowCount: number;
  readonly filterActive: boolean;
}): MatrixEmptyKind {
  if (input.milestoneCount === 0) return 'no-milestones';
  if (input.rowCount > 0) return null;
  return input.filterActive ? 'no-results' : 'no-applications';
}

export function isLateSubmission(cell: MatrixCell): boolean {
  return cell.deliveryStatus === 'LATE';
}

export function matrixRowDeliveryStatus(
  row: MatrixRow,
  milestones: readonly MatrixMilestone[],
): DocumentDeliveryStatus {
  const statuses = milestones.map(
    (milestone) => cellForMilestone(row, milestone.id).deliveryStatus,
  );
  if (statuses.includes('MISSING')) return 'MISSING';
  if (statuses.includes('LATE')) return 'LATE';
  if (statuses.includes('COMPLETE')) return 'COMPLETE';
  return 'NO_REQUIRED_ITEMS';
}

export type MatrixQuickFilter = 'ALL' | DocumentDeliveryStatus;

export function matrixRowHasEmptyCell(
  row: MatrixRow,
  milestones: readonly MatrixMilestone[],
): boolean {
  return milestones.some(
    (milestone) =>
      cellForMilestone(row, milestone.id).deliveryStatus === 'MISSING',
  );
}

export function applyMatrixQuickFilter(
  rows: readonly MatrixRow[],
  milestones: readonly MatrixMilestone[],
  filter: MatrixQuickFilter,
): readonly MatrixRow[] {
  if (filter !== 'ALL')
    return rows.filter(
      (row) => matrixRowDeliveryStatus(row, milestones) === filter,
    );
  return rows;
}

export interface MatrixPageStats {
  readonly totalCells: number;
  readonly filledCells: number;
  readonly emptyCells: number;
  readonly noRequiredCells: number;

  readonly lateCells: number;
}

export function matrixPageStats(
  rows: readonly MatrixRow[],
  milestones: readonly MatrixMilestone[],
): MatrixPageStats {
  let totalCells = 0;
  let filledCells = 0;
  let noRequiredCells = 0;
  let lateCells = 0;
  for (const row of rows) {
    for (const milestone of milestones) {
      const status = cellForMilestone(row, milestone.id).deliveryStatus;
      if (status === 'NO_REQUIRED_ITEMS') {
        noRequiredCells += 1;
        continue;
      }
      totalCells += 1;
      if (status === 'COMPLETE' || status === 'LATE') filledCells += 1;
      if (status === 'LATE') lateCells += 1;
    }
  }
  return {
    totalCells,
    filledCells,
    emptyCells: totalCells - filledCells,
    noRequiredCells,
    lateCells,
  };
}
