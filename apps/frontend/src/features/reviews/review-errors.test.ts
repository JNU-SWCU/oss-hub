import { describe, expect, it } from 'vitest';

import { ApiError } from '@/lib/api-client';

import { isReviewConflict } from './review-errors';

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

describe('isReviewConflict', () => {
  it.each(['SUB_003', 'SUB_004'])(
    '%s이면 판정을 초기화하고 최신 제출을 다시 조회한다',
    (code) => {
      expect(isReviewConflict(apiError(code))).toBe(true);
    },
  );
  it('다른 API 오류는 판정 초기화를 유발하지 않는다', () => {
    expect(isReviewConflict(apiError('SUB_005'))).toBe(false);
  });
  it('네트워크 오류는 판정 초기화를 유발하지 않는다', () => {
    expect(isReviewConflict(new Error('network down'))).toBe(false);
  });
  it('API 오류가 아닌 객체의 코드로 판정을 초기화하지 않는다', () => {
    expect(isReviewConflict({ problem: { code: 'SUB_003' } })).toBe(false);
  });
});
