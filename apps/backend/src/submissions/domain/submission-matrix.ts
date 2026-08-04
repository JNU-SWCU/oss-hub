import type { SubmissionStatus } from '@prisma/client';

/** #124 형태 필터 — 저장 enum이 아니라 Application.teamId 유무의 파생값이다. */
export const MATRIX_APPLICATION_MODES = ['PERSONAL', 'TEAM'] as const;

export type MatrixApplicationMode = (typeof MATRIX_APPLICATION_MODES)[number];

export interface SubmissionMatrixFilter {
  /** 신청자 이름·팀명·GitHub 핸들 contains 검색어. 빈 문자열이면 필터 없음. */
  readonly q: string;
  readonly applicationMode: MatrixApplicationMode | null;
}

export interface SubmissionMatrixQuery extends SubmissionMatrixFilter {
  readonly page: number;
  readonly pageSize: number;
}

/** OVERDUE는 저장 enum이 아니라 dueAt 파생 표시라 셀 상태에 포함하지 않는다(#124). */
export type MatrixCellStatus = SubmissionStatus | 'NOT_SUBMITTED';

/** 제출 셀만 #125 최신 revision 검토 화면으로 이동한다 — 미제출 셀은 reviewUrl=null. */
export function submissionMatrixReviewUrl(
  programId: string,
  submissionId: string,
): string {
  return `/programs/${programId}/submissions/${submissionId}/review`;
}
