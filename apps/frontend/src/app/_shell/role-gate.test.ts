import { describe, expect, it } from 'vitest';

import { roleGateRedirectPath } from './role-gate';

describe('roleGateRedirectPath', () => {
  // 회귀 방지: 조회 실패를 anonymous로 접어 넣으면 로그인한 사용자가 랜딩으로
  // 밀려나고 화면상 로그아웃된 것처럼 보인다. 실패는 어디로도 보내지 않는다.
  it('세션 조회 실패는 어디로도 리다이렉트하지 않는다', () => {
    expect(
      roleGateRedirectPath(
        { status: 'error', role: null, roleRequestStatus: null },
        ['STUDENT'],
      ),
    ).toBeNull();
  });

  it('조회 실패는 deniedPath가 주어져도 리다이렉트하지 않는다', () => {
    expect(
      roleGateRedirectPath(
        { status: 'error', role: null, roleRequestStatus: null },
        ['STUDENT'],
        '/staff/dashboard',
      ),
    ).toBeNull();
  });

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
