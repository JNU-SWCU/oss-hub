import type { SubmissionStatus } from '@prisma/client';

export const MATRIX_APPLICATION_MODES = ['PERSONAL', 'TEAM'] as const;

export type MatrixApplicationMode = (typeof MATRIX_APPLICATION_MODES)[number];

export interface SubmissionMatrixFilter {
  readonly q: string;
  readonly applicationMode: MatrixApplicationMode | null;
}

export interface SubmissionMatrixQuery extends SubmissionMatrixFilter {
  readonly page: number;
  readonly pageSize: number;
}

export type MatrixCellStatus = SubmissionStatus | 'NOT_SUBMITTED';

export function submissionMatrixReviewUrl(
  programId: string,
  submissionId: string,
): string {
  return `/programs/${programId}/submissions/${submissionId}/review`;
}
