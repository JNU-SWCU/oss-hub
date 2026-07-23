import { describe, expect, it } from 'vitest';

import { onboardingPathFor } from './onboarding-route';

describe('onboardingPathFor', () => {
  it.each([null, 'PENDING'] as const)(
    '프로필이 미완료면 역할 요청 상태와 무관하게 프로필 입력으로 보낸다',
    (requestStatus) => {
      // Given
      const profileStatus = 'incomplete';

      // When
      const path = onboardingPathFor(requestStatus, profileStatus);

      // Then
      expect(path).toBe('/onboarding/profile');
    },
  );

  it.each(['checking', 'error'] as const)(
    '프로필 상태가 %s이면 역할 화면 경로를 확정하지 않는다',
    (profileStatus) => {
      // Given
      const requestStatus = null;

      // When
      const path = onboardingPathFor(requestStatus, profileStatus);

      // Then
      expect(path).toBeNull();
    },
  );

  it('역할 요청이 없으면 역할 선택으로 보낸다', () => {
    // Given
    const requestStatus = null;
    const profileStatus = 'complete';

    // When
    const path = onboardingPathFor(requestStatus, profileStatus);

    // Then
    expect(path).toBe('/onboarding/role');
  });

  it.each(['PENDING', 'REJECTED', 'APPROVED'] as const)(
    '%s 요청 이력이 있으면 요청 상태 화면으로 보낸다',
    (requestStatus) => {
      // Given
      const profileStatus = 'complete';

      // When
      const path = onboardingPathFor(requestStatus, profileStatus);

      // Then
      expect(path).toBe('/onboarding/pending');
    },
  );

  it('회수된 요청은 역할을 다시 선택하도록 보낸다', () => {
    // Given
    const requestStatus = 'REVOKED';

    // When
    const path = onboardingPathFor(requestStatus);

    // Then
    expect(path).toBe('/onboarding/role');
  });
});
