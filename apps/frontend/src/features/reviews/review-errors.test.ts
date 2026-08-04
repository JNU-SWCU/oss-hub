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
  it('SUB_003이면 새 제출본 안내를 반환한다', () => {
    expect(reviewConflictMessage(apiError('SUB_003'))).toBe(
      '학생이 새 제출본을 올려 최신 내용을 다시 불러왔습니다. 새 제출본을 확인한 뒤 다시 판정해 주세요.',
    );
  });

  it('SUB_004이면 이미 판정된 제출본 안내를 반환한다', () => {
    expect(reviewConflictMessage(apiError('SUB_004'))).toBe(
      '이미 판정이 끝난 제출본입니다. 최신 내용을 다시 불러왔으니 화면의 판정 결과를 확인해 주세요.',
    );
  });

  // #354 — 충돌 안내는 교직원이 보는 문구다. 내부 용어 revision을 노출하지 않고
  // "다음에 무엇을 하면 되는지"를 문구 안에 담아야 한다.
  it.each(['SUB_003', 'SUB_004'])(
    '%s 충돌 안내는 내부 용어 revision 없이 다음 행동을 알려준다',
    (code) => {
      const message = reviewConflictMessage(apiError(code)) ?? '';

      expect(message).not.toMatch(/revision/i);
      expect(message).toContain('제출본');
      expect(message).toMatch(/다시 .*해 주세요/);
    },
  );

  it('다른 오류는 충돌 안내로 바꾸지 않는다', () => {
    expect(reviewConflictMessage(apiError('SUB_005'))).toBeNull();
  });
});
