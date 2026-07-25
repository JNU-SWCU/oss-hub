import { describe, expect, it } from 'vitest';

import { roleGateRedirectPath } from './role-gate';

describe('roleGateRedirectPath', () => {
  it.each(['STAFF', 'ADMIN'] as const)(
    '학생 대시보드에서 %s를 지정된 운영 화면으로 보낸다',
    (role) => {
      expect(
        roleGateRedirectPath(
          {
            status: 'assigned',
            role,
            roleRequestStatus: null,
          },
          ['STUDENT'],
          '/staff/dashboard',
        ),
      ).toBe('/staff/dashboard');
    },
  );

  it('역할 미선택 사용자는 기존 온보딩 흐름을 유지한다', () => {
    expect(
      roleGateRedirectPath(
        {
          status: 'unassigned',
          role: null,
          roleRequestStatus: null,
        },
        ['STUDENT'],
        '/staff/dashboard',
      ),
    ).toBe('/onboarding/role');
  });
});
