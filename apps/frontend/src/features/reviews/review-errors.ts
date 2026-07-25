import { ApiError } from '@/lib/api-client';

const REVIEW_ERROR_CODES = {
  staleRevision: 'SUB_003',
  alreadyReviewed: 'SUB_004',
} as const;

export function reviewConflictMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.problem.code === REVIEW_ERROR_CODES.staleRevision) {
    return '새 revision이 제출되어 최신 내용을 다시 불러왔습니다.';
  }
  if (error.problem.code === REVIEW_ERROR_CODES.alreadyReviewed) {
    return '이미 판정된 revision입니다. 최신 내용을 다시 불러왔습니다.';
  }
  return null;
}
