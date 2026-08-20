import { ApiError } from '@/lib/api-client';

const REVIEW_ERROR_CODES = {
  staleRevision: 'SUB_003',
  alreadyReviewed: 'SUB_004',
} as const;

export function reviewConflictMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null;
  if (error.problem.code === REVIEW_ERROR_CODES.staleRevision) {
    return '학생이 새 제출본을 올려 최신 내용을 다시 불러왔습니다. 새 제출본을 확인한 뒤 다시 검토해 주세요.';
  }
  if (error.problem.code === REVIEW_ERROR_CODES.alreadyReviewed) {
    return '이미 검토가 끝난 제출본입니다. 최신 내용을 다시 불러왔으니 화면의 결과를 확인해 주세요.';
  }
  return null;
}
