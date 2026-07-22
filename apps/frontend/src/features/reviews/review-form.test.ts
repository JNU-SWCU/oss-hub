import { describe, expect, it } from 'vitest';

import { reviewFormError } from './review-form';

describe('reviewFormError', () => {
  it('판정을 선택하지 않으면 저장을 막는다', () => {
    // Given
    const decision = '';

    // When
    const error = reviewFormError(decision, '검토 의견');

    // Then
    expect(error).toBe('판정을 선택해 주세요.');
  });

  it.each(['CHANGES_REQUESTED', 'REJECTED'] as const)(
    '%s 판정은 빈 코멘트를 허용하지 않는다',
    (decision) => {
      // Given
      const comment = '   ';

      // When
      const error = reviewFormError(decision, comment);

      // Then
      expect(error).toBe('보완 요청과 최종 반려에는 코멘트가 필요합니다.');
    },
  );

  it('승인은 코멘트 없이 저장할 수 있다', () => {
    // Given
    const decision = 'APPROVED';

    // When
    const error = reviewFormError(decision, '');

    // Then
    expect(error).toBeNull();
  });
});
