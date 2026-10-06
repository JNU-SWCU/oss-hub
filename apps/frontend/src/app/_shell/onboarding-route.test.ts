import { describe, expect, it } from 'vitest';

import { effectiveProfileRole, onboardingPathFor } from './onboarding-route';

describe('onboardingPathFor', () => {
  it.each(['incomplete', 'complete', 'checking'] as const)(
    '역할을 아직 고르지 않았으면 프로필 상태(%s)와 무관하게 역할 선택으로 보낸다',
    (profileStatus) => {
      const requestStatus = null;

      const path = onboardingPathFor(requestStatus, profileStatus);

      expect(path).toBe('/onboarding/role');
    },
  );

  it('회수된 요청은 역할을 다시 선택하도록 보낸다', () => {
    const requestStatus = 'REVOKED';

    const path = onboardingPathFor(requestStatus);

    expect(path).toBe('/onboarding/role');
  });

  it.each(['PENDING', 'APPROVED'] as const)(
    '%s 요청이 있고 프로필이 비어 있으면 프로필 입력으로 보낸다',
    (requestStatus) => {
      const profileStatus = 'incomplete';

      const path = onboardingPathFor(requestStatus, profileStatus);

      expect(path).toBe('/onboarding/profile');
    },
  );

  it.each(['checking', 'error'] as const)(
    '역할을 고른 뒤 프로필 상태가 %s이면 경로를 확정하지 않는다',
    (profileStatus) => {
      const requestStatus = 'PENDING';

      const path = onboardingPathFor(requestStatus, profileStatus);

      expect(path).toBeNull();
    },
  );

  it.each(['PENDING', 'APPROVED'] as const)(
    '%s 요청과 완료된 프로필은 요청 상태 화면으로 보낸다',
    (requestStatus) => {
      const profileStatus = 'complete';

      const path = onboardingPathFor(requestStatus, profileStatus);

      expect(path).toBe('/onboarding/pending');
    },
  );

  it.each(['incomplete', 'complete'] as const)(
    '반려된 요청은 프로필이 %s여도 역할 선택으로 보낸다',
    (profileStatus) => {
      const requestStatus = 'REJECTED';

      const path = onboardingPathFor(requestStatus, profileStatus);

      expect(path).toBe('/onboarding/role');
    },
  );
});

describe('effectiveProfileRole', () => {
  it('배정된 역할이 있으면 그대로 쓴다', () => {
    expect(effectiveProfileRole('STUDENT', null)).toBe('STUDENT');
    expect(effectiveProfileRole('ADMIN', null)).toBe('ADMIN');
  });

  it.each(['PENDING', 'APPROVED'] as const)(
    '%s 요청 중인 사용자는 승인 전이라도 교직원 기준으로 본다',
    (requestStatus) => {
      expect(effectiveProfileRole(null, requestStatus)).toBe('STAFF');
    },
  );

  it.each([null, 'REJECTED', 'REVOKED'] as const)(
    '요청이 %s이면 역할을 단정하지 않는다',
    (requestStatus) => {
      expect(effectiveProfileRole(null, requestStatus)).toBeNull();
    },
  );
});
