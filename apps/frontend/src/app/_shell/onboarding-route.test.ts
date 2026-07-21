import { describe, expect, it } from 'vitest';

import { onboardingPathFor } from './onboarding-route';

describe('onboardingPathFor', () => {
  it('역할 요청이 없으면 역할 선택으로 보낸다', () => {
    // Given
    const requestStatus = null;

    // When
    const path = onboardingPathFor(requestStatus);

    // Then
    expect(path).toBe('/onboarding/role');
  });

  it.each(['PENDING', 'REJECTED', 'APPROVED'] as const)(
    '%s 요청 이력이 있으면 요청 상태 화면으로 보낸다',
    (requestStatus) => {
      // Given: 역할 요청 상태가 존재한다.

      // When
      const path = onboardingPathFor(requestStatus);

      // Then
      expect(path).toBe('/onboarding/pending');
    },
  );
});
