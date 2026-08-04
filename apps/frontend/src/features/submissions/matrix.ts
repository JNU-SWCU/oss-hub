import type {
  MatrixApplicationMode,
  MatrixCell,
  MatrixCellStatus,
  MatrixMilestone,
  MatrixRow,
} from './types';

const SEOUL_TIME_ZONE = 'Asia/Seoul';

export const MATRIX_PAGE_SIZE = 20;

export interface MatrixQueryInput {
  readonly q: string;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * 서류 현황 표의 칸은 저장 enum 5종을 **화면 3종으로 접어** 보여 준다
 * (`docs/design.md` §업무 화면 내비게이션 › 서류 현황 표).
 * 교직원이 이 표에서 묻는 것은 "냈나 / 늦게 냈나 / 안 냈나"이지 검토 단계가 아니다.
 * 검토 단계는 행의 「열어 보기」로 들어가 리뷰 화면에서 본다.
 */
export const MATRIX_CELL_DISPLAY_LABELS = {
  SUBMITTED: '제출함',
  LATE: '지각',
  NOT_SUBMITTED: '미제출',
} as const;

export type MatrixCellDisplay = keyof typeof MATRIX_CELL_DISPLAY_LABELS;

export const MATRIX_CELL_DISPLAY_VARIANTS = {
  SUBMITTED: 'approved',
  LATE: 'pending',
  NOT_SUBMITTED: 'rejected',
} as const satisfies Readonly<
  Record<MatrixCellDisplay, 'pending' | 'approved' | 'rejected'>
>;

/**
 * 저장 enum + 마감 시각을 화면 3종으로 접는다. 빈칸이 곧 미제출이고,
 * 낸 뒤 마감을 넘긴 것은 지각으로 가른다(`isLateSubmission`이 판정 근거).
 */
export function matrixCellDisplay(
  cell: MatrixCell,
  milestone: MatrixMilestone,
): MatrixCellDisplay {
  if (cell.status === 'NOT_SUBMITTED') return 'NOT_SUBMITTED';
  return isLateSubmission(cell, milestone) ? 'LATE' : 'SUBMITTED';
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

const DUE_DATE_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SEOUL_TIME_ZONE,
  month: 'long',
  day: 'numeric',
});

/** 열 머리글용 마감일 — Asia/Seoul 달력 기준 "M월 D일". */
export function formatMatrixDueDate(dueAt: string): string {
  return DUE_DATE_FORMAT.format(new Date(dueAt));
}

function seoulCalendarDayNumber(value: Date): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(value);
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

export interface NotSubmittedDeadline {
  readonly overdue: boolean;
  readonly label: string;
}

/**
 * NOT_SUBMITTED 셀의 보조 표시 — OVERDUE는 저장 enum이 아니라 dueAt 파생(#124).
 * overdue 여부는 시각 비교(now > dueAt), D±n은 Asia/Seoul 달력일 차이로
 * backend(programs/program-deadline.ts)와 같은 규칙을 쓴다.
 */
export function notSubmittedDeadline(
  dueAt: string,
  now: Date,
): NotSubmittedDeadline {
  const due = new Date(dueAt);
  const dDay = seoulCalendarDayNumber(due) - seoulCalendarDayNumber(now);
  if (now.getTime() > due.getTime()) {
    return {
      overdue: true,
      label: dDay < 0 ? `OVERDUE D+${-dDay}` : 'OVERDUE',
    };
  }
  return { overdue: false, label: dDay === 0 ? '오늘 마감' : `D-${dDay}` };
}

const SUBMITTED_AT_FORMAT = new Intl.DateTimeFormat('ko-KR', {
  timeZone: SEOUL_TIME_ZONE,
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** 제출 시각 표시 — 프로토타입 표기("09.16 14:22")와 같은 "MM.DD HH:MM" 포맷. */
export function formatSubmittedAt(submittedAt: string): string {
  const parts = SUBMITTED_AT_FORMAT.formatToParts(new Date(submittedAt));
  const get = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${get('month')}.${get('day')} ${get('hour')}:${get('minute')}`;
}

/** 제출됨 셀이 해당 마일스톤 마감(dueAt) 이후에 들어왔는지 — "지각" 판정(#619 스펙). */
export function isLateSubmission(
  cell: MatrixCell,
  milestone: MatrixMilestone,
): boolean {
  if (cell.status === 'NOT_SUBMITTED' || cell.submittedAt === null) {
    return false;
  }
  return (
    new Date(cell.submittedAt).getTime() > new Date(milestone.dueAt).getTime()
  );
}

/** #619 스펙 3버튼 빠른 필터 — "전체"/"빈 칸 있는 팀"/"한 장도 안 낸 팀". */
export type MatrixQuickFilter = 'ALL' | 'HAS_EMPTY' | 'ZERO_SUBMISSION';

/** 빈 칸 있는 팀 — 로드된 마일스톤 중 하나라도 NOT_SUBMITTED인 행. */
export function matrixRowHasEmptyCell(
  row: MatrixRow,
  milestones: readonly MatrixMilestone[],
): boolean {
  return milestones.some(
    (milestone) =>
      cellForMilestone(row, milestone.id).status === 'NOT_SUBMITTED',
  );
}

/** 한 장도 안 낸 팀 — 로드된 마일스톤 전부가 NOT_SUBMITTED인 행. */
export function matrixRowIsZeroSubmission(
  row: MatrixRow,
  milestones: readonly MatrixMilestone[],
): boolean {
  return milestones.every(
    (milestone) =>
      cellForMilestone(row, milestone.id).status === 'NOT_SUBMITTED',
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
  if (filter === 'HAS_EMPTY') {
    return rows.filter((row) => matrixRowHasEmptyCell(row, milestones));
  }
  if (filter === 'ZERO_SUBMISSION') {
    return rows.filter((row) => matrixRowIsZeroSubmission(row, milestones));
  }
  return rows;
}

export interface MatrixPageStats {
  /** 로드된(현재 페이지) 행 × 마일스톤 칸 수. */
  readonly totalCells: number;
  readonly filledCells: number;
  readonly emptyCells: number;
  /** 모든 마일스톤이 NOT_SUBMITTED인 행(팀) 수. */
  readonly zeroSubmissionRows: number;
  /** dueAt 이후 제출된 칸 수. */
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
  const totalCells = rows.length * milestones.length;
  let filledCells = 0;
  let zeroSubmissionRows = 0;
  let lateCells = 0;
  for (const row of rows) {
    let rowHasSubmission = false;
    for (const milestone of milestones) {
      const cell = cellForMilestone(row, milestone.id);
      if (cell.status !== 'NOT_SUBMITTED') {
        filledCells += 1;
        rowHasSubmission = true;
        if (isLateSubmission(cell, milestone)) lateCells += 1;
      }
    }
    if (!rowHasSubmission) zeroSubmissionRows += 1;
  }
  return {
    totalCells,
    filledCells,
    emptyCells: totalCells - filledCells,
    zeroSubmissionRows,
    lateCells,
  };
}
