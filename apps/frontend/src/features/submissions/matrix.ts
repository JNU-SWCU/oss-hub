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

/** 검토 결과는 필수 서류의 제출 상태와 독립적으로 표시한다. */
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

export function matrixCellDisplay(
  cell: MatrixCell,
  _milestone: MatrixMilestone,
): MatrixCellDisplay {
  return cell.status;
}

export const MATRIX_MODE_LABELS = {
  PERSONAL: '개인',
  TEAM: '팀',
} as const satisfies Readonly<Record<MatrixApplicationMode, string>>;

/** #124 계약: q는 값이 있을 때만 보낸다. page·pageSize는 항상 포함.
 * applicationMode 쿼리는 D6로 폐지 — 서버도 무시하므로 보내지 않는다.
 */
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

/** 계약상 미제출 cell도 항상 내려오지만, 누락돼도 행이 깨지지 않게 방어한다. */
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

/**
 * 행 제목 — 개인형은 신청자 이름, 팀형은 "팀명(인원)"(#124 집계 규칙).
 * 응답에 별도 인원 필드가 없어 인원은 githubLogins 수로 파생한다.
 */
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

/**
 * 빈 화면 구분(#124 화면 상태) — 마일스톤 없음이 최우선(#101 안내),
 * 다음이 승인 신청 없음/검색 결과 없음.
 */
export function matrixEmptyKind(input: {
  readonly milestoneCount: number;
  readonly rowCount: number;
  readonly filterActive: boolean;
}): MatrixEmptyKind {
  if (input.milestoneCount === 0) return 'no-milestones';
  if (input.rowCount > 0) return null;
  return input.filterActive ? 'no-results' : 'no-applications';
}

/** The server derives lateness from the first successful submission, including reviewed items. */
export function isLateSubmission(
  cell: MatrixCell,
  _milestone?: MatrixMilestone,
): boolean {
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

/** 빈 칸 있는 팀 — 로드된 마일스톤 중 하나라도 NOT_SUBMITTED인 행. */
export function matrixRowHasEmptyCell(
  row: MatrixRow,
  milestones: readonly MatrixMilestone[],
): boolean {
  return milestones.some(
    (milestone) =>
      cellForMilestone(row, milestone.id).deliveryStatus === 'MISSING',
  );
}

/**
 * 빠른 필터 적용 — matrixPageStats와 같은 전제로 이 페이지에 로드된 행만
 * 대상으로 한다(서버 재조회 없음).
 */
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
  /** 현재 페이지에서 필수 서류가 있는 팀별 단계 수. */
  readonly totalCells: number;
  readonly filledCells: number;
  readonly emptyCells: number;
  readonly noRequiredCells: number;
  /** 필수 서류의 최초 제출이 마감 이후인 팀별 단계 수. */
  readonly lateCells: number;
}

/**
 * 현재 페이지에 로드된 행만을 기준으로 한 요약 — #124 API가 페이지 단위로
 * 응답하므로 전체 total 행을 기준으로 한 정확한 전체 집계는 별도 백엔드
 * 집계 API 없이는 낼 수 없다. 호출부는 이 값을 "이 페이지 기준"으로 표기한다.
 */
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
