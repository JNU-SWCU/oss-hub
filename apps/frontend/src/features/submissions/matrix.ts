import type { SubmissionDisplayStatus } from '@/lib/status-vocabulary';
import { notSubmittedDeadline } from './matrix-format';
import type {
  MatrixApplicationMode,
  MatrixCell,
  MatrixMilestone,
  MatrixRow,
} from './types';
export {
  formatMatrixDueDate,
  formatSubmittedAt,
  notSubmittedDeadline,
} from './matrix-format';

export const MATRIX_PAGE_SIZE = 20;

export interface MatrixQueryInput {
  readonly q: string;
  readonly page: number;
  readonly pageSize: number;
}

export const MATRIX_MODE_LABELS = {
  PERSONAL: '개인',
} as const satisfies Readonly<Partial<Record<MatrixApplicationMode, string>>>;

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
      changesRequestedCount: 0,
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

export type MatrixActionStatus = SubmissionDisplayStatus | 'NONE';

export interface MatrixCellAction {
  readonly status: MatrixActionStatus;
  readonly late: boolean;
}

export function matrixCellAction(
  cell: MatrixCell,
  milestone: MatrixMilestone,
  now: Date,
): MatrixCellAction {
  const late = cell.deliveryStatus === 'LATE';
  if (cell.deliveryStatus === 'MISSING') {
    const overdue = notSubmittedDeadline(milestone.dueAt, now).overdue;
    return { status: overdue ? 'OVERDUE' : 'NOT_SUBMITTED', late };
  }
  if (
    cell.deliveryStatus === 'NO_REQUIRED_ITEMS' &&
    cell.status === 'NOT_SUBMITTED'
  ) {
    return { status: 'NONE', late };
  }
  return { status: cell.status, late };
}

const MATRIX_ACTION_PRIORITY = [
  'OVERDUE',
  'SUBMITTED',
  'CHANGES_REQUESTED',
  'NOT_SUBMITTED',
  'REJECTED',
  'APPROVED',
] as const satisfies readonly Exclude<MatrixActionStatus, 'NONE'>[];

export function matrixRowAction(
  row: MatrixRow,
  milestones: readonly MatrixMilestone[],
  now: Date,
): MatrixActionStatus {
  const statuses = new Set(
    milestones.map(
      (milestone) =>
        matrixCellAction(cellForMilestone(row, milestone.id), milestone, now)
          .status,
    ),
  );
  return (
    MATRIX_ACTION_PRIORITY.find((status) => statuses.has(status)) ?? 'NONE'
  );
}

export type MatrixQuickFilter = 'ALL' | Exclude<MatrixActionStatus, 'NONE'>;

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
  now: Date,
): readonly MatrixRow[] {
  if (filter === 'ALL') return rows;
  return rows.filter((row) => matrixRowAction(row, milestones, now) === filter);
}

export type MatrixPageStats = Readonly<Record<MatrixActionStatus, number>>;

export function matrixPageStats(
  rows: readonly MatrixRow[],
  milestones: readonly MatrixMilestone[],
  now: Date,
): MatrixPageStats {
  const stats: Record<MatrixActionStatus, number> = {
    OVERDUE: 0,
    NOT_SUBMITTED: 0,
    SUBMITTED: 0,
    CHANGES_REQUESTED: 0,
    APPROVED: 0,
    REJECTED: 0,
    NONE: 0,
  };
  for (const row of rows) {
    for (const milestone of milestones) {
      const { status } = matrixCellAction(
        cellForMilestone(row, milestone.id),
        milestone,
        now,
      );
      stats[status] += 1;
    }
  }
  return stats;
}
