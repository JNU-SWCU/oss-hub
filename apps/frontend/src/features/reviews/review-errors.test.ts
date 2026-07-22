import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import { reviewConflictMessage } from './review-errors';

function apiError(code: string): ApiError {
  return new ApiError({
    type: 'about:blank',
    title: 'CONFLICT',
    status: 409,
    detail: '충돌이 발생했습니다.',
    instance: '/submissions/submission-existing/reviews',
    code,
  });
}

describe('reviewConflictMessage', () => {
  it('SUB_003이면 stale revision 안내를 반환한다', () => {
    expect(reviewConflictMessage(apiError('SUB_003'))).toBe(
      '새 revision이 제출되어 최신 내용을 다시 불러왔습니다.',
    );
  });

  it('SUB_004이면 이미 판정된 revision 안내를 반환한다', () => {
    expect(reviewConflictMessage(apiError('SUB_004'))).toBe(
      '이미 판정된 revision입니다. 최신 내용을 다시 불러왔습니다.',
    );
  });

  it('다른 오류는 충돌 안내로 바꾸지 않는다', () => {
    expect(reviewConflictMessage(apiError('SUB_005'))).toBeNull();
  });
});
