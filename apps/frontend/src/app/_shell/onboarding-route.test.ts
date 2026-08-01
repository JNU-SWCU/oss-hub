import { describe, expect, it } from 'vitest';

import { effectiveProfileRole, onboardingPathFor } from './onboarding-route';

describe('onboardingPathFor', () => {
  it.each(['incomplete', 'complete', 'checking'] as const)(
    '역할을 아직 고르지 않았으면 프로필 상태(%s)와 무관하게 역할 선택으로 보낸다',
    (profileStatus) => {
      // Given — 순서가 약관 → 역할 → 프로필이라 역할이 첫 질문이다
      const requestStatus = null;

      // When
      const path = onboardingPathFor(requestStatus, profileStatus);

      // Then
      expect(path).toBe('/onboarding/role');
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

  it.each(['PENDING', 'APPROVED'] as const)(
    '%s 요청이 있고 프로필이 비어 있으면 프로필 입력으로 보낸다',
    (requestStatus) => {
      // Given — 역할을 골랐으니 이제 그 역할에 맞는 항목만 물을 수 있다
      const profileStatus = 'incomplete';

      // When
      const path = onboardingPathFor(requestStatus, profileStatus);

      // Then — 여기서 승인 대기로 보내 버리면 교직원은 프로필을 채울 자리가 없다
      expect(path).toBe('/onboarding/profile');
    },
  );

  it.each(['checking', 'error'] as const)(
    '역할을 고른 뒤 프로필 상태가 %s이면 경로를 확정하지 않는다',
    (profileStatus) => {
      // Given
      const requestStatus = 'PENDING';

      // When
      const path = onboardingPathFor(requestStatus, profileStatus);

      // Then
      expect(path).toBeNull();
    },
  );

  it.each(['PENDING', 'APPROVED'] as const)(
    '%s 요청과 완료된 프로필은 요청 상태 화면으로 보낸다',
    (requestStatus) => {
      // Given
      const profileStatus = 'complete';

      // When
      const path = onboardingPathFor(requestStatus, profileStatus);

      // Then
      expect(path).toBe('/onboarding/pending');
    },
  );

  it.each(['incomplete', 'complete'] as const)(
    '반려된 요청은 프로필이 %s여도 요청 상태 화면으로 보낸다',
    (profileStatus) => {
      // Given — 반려된 사용자는 역할을 다시 골라야 하고, 무엇을 고르느냐에 따라
      // 필요한 프로필 항목이 달라진다. 그 전에 프로필을 물으면 기준이 없다.
      const requestStatus = 'REJECTED';

      // When
      const path = onboardingPathFor(requestStatus, profileStatus);

      // Then
      expect(path).toBe('/onboarding/pending');
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
      // Given / When / Then — 승인 대기 중에 프로필을 채우는 사람이 바로 그
      // 교직원이다. 학생 기준으로 되돌리면 학번을 요구받는다.
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
