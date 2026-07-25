import type {
  MatrixApplicationMode,
  MatrixCell,
  MatrixCellStatus,
  MatrixRow,
} from './types';

const SEOUL_TIME_ZONE = 'Asia/Seoul';

export const MATRIX_PAGE_SIZE = 20;

/** 형태 필터 — ALL은 query에서 applicationMode를 생략한다(#124 계약). */
export type MatrixModeFilter = 'ALL' | MatrixApplicationMode;

export interface MatrixQueryInput {
  readonly q: string;
  readonly mode: MatrixModeFilter;
  readonly page: number;
  readonly pageSize: number;
}

/**
 * 매트릭스 셀 상태 라벨 — 기존 화면(features/programs/program-detail-format.ts의
 * SUBMISSION_LABELS)과 동일 문자열을 유지한다. feature 간 직접 의존이 금지라
 * (docs/rules/frontend.md) 문자열 계약만 복제한다.
 */
export const MATRIX_STATUS_LABELS = {
  NOT_SUBMITTED: '제출 전',
  SUBMITTED: '제출됨',
  APPROVED: '승인',
  CHANGES_REQUESTED: '보완 필요',
  REJECTED: '최종 반려',
} as const satisfies Readonly<Record<MatrixCellStatus, string>>;

/** 상태→뱃지 색 — 기존 화면(milestone-row.tsx의 STATUS_VARIANTS)과 동일 매핑. */
export const MATRIX_STATUS_VARIANTS = {
  NOT_SUBMITTED: 'pending',
  SUBMITTED: 'pending',
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'rejected',
  REJECTED: 'rejected',
} as const satisfies Readonly<
  Record<MatrixCellStatus, 'pending' | 'approved' | 'rejected'>
>;

export const MATRIX_MODE_LABELS = {
  PERSONAL: '개인',
  TEAM: '팀',
} as const satisfies Readonly<Record<MatrixApplicationMode, string>>;

export function parseMatrixModeFilter(value: string): MatrixModeFilter {
  if (value === 'PERSONAL' || value === 'TEAM') return value;
  return 'ALL';
}

/** #124 계약: q·applicationMode는 값이 있을 때만 보낸다. page·pageSize는 항상 포함. */
export function buildMatrixSearchParams(
  input: MatrixQueryInput,
): URLSearchParams {
  const params = new URLSearchParams();
  const q = input.q.trim();
  if (q !== '') params.set('q', q);
  if (input.mode !== 'ALL') params.set('applicationMode', input.mode);
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

export function isMatrixFilterActive(
  q: string,
  mode: MatrixModeFilter,
): boolean {
  return q.trim() !== '' || mode !== 'ALL';
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
