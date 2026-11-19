import { SubmissionStatus } from '@prisma/client';

export const MATRIX_APPLICATION_MODES = ['PERSONAL', 'TEAM'] as const;
export const MATRIX_CELL_STATUSES = [
  'NOT_SUBMITTED',
  SubmissionStatus.SUBMITTED,
  SubmissionStatus.CHANGES_REQUESTED,
  SubmissionStatus.REJECTED,
  SubmissionStatus.APPROVED,
] as const;
