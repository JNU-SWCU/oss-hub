import { ApiError } from '@/lib/api-client';

const REVIEW_ERROR_CODES = {
  staleRevision: 'SUB_003',
  alreadyReviewed: 'SUB_004',
} as const;

export function isReviewConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.problem.code === REVIEW_ERROR_CODES.staleRevision ||
      error.problem.code === REVIEW_ERROR_CODES.alreadyReviewed ||
      error.problem.code === 'MSD_024' ||
      error.problem.code === 'MSD_025')
  );
}
