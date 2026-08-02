import { describe, expect, it } from 'vitest';

import {
  roleGateDeniedHomePath,
  roleGateRedirectPath,
  shouldDelayRedirectForNotice,
} from './role-gate';

describe('roleGateRedirectPath', () => {
  // 회귀 방지: 조회 실패를 anonymous로 접어 넣으면 로그인한 사용자가 랜딩으로
  // 밀려나고 화면상 로그아웃된 것처럼 보인다. 실패는 어디로도 보내지 않는다.
  it('세션 조회 실패는 어디로도 리다이렉트하지 않는다', () => {
    expect(
      roleGateRedirectPath({
        status: 'error',
        role: null,
        roleRequestStatus: null,
        isProfileComplete: true,
      }),
    ).toBeNull();
  });

  // 권한 불일치를 조용히 되돌리면 사용자는 왜 다른 화면이 떠 있는지 모른 채
  // 같은 시도를 반복한다. 이제 이동시키지 않고 안내 화면을 띄운다 — 그래서 이
  // 판단은 어떤 역할이 허용됐는지(`allow`)를 아예 보지 않는다.
  it.each(['STAFF', 'ADMIN'] as const)(
    '역할이 배정된 %s는 허용 목록과 무관하게 이동시키지 않는다',
    (role) => {
      expect(
        roleGateRedirectPath({
          status: 'assigned',
          role,
          roleRequestStatus: null,
          isProfileComplete: true,
        }),
      ).toBeNull();
    },
  );

  it('프로필까지 마친 학생도 이동시키지 않는다', () => {
    expect(
      roleGateRedirectPath({
        status: 'assigned',
        role: 'STUDENT',
        roleRequestStatus: null,
        isProfileComplete: true,
      }),
    ).toBeNull();
  });

  it('안내 화면의 돌아가기는 deniedPath를, 없으면 자기 역할 홈을 가리킨다', () => {
    expect(roleGateDeniedHomePath('STAFF', '/staff/dashboard')).toBe(
      '/staff/dashboard',
    );
    expect(roleGateDeniedHomePath('STAFF')).toBe('/staff/dashboard');
    expect(roleGateDeniedHomePath('STUDENT')).toBe('/dashboard');
    expect(roleGateDeniedHomePath('ADMIN')).toBe('/admin/access');
  });

  it('역할 미선택 사용자는 기존 온보딩 흐름을 유지한다', () => {
    expect(
      roleGateRedirectPath({
        status: 'unassigned',
        role: null,
        roleRequestStatus: null,
        isProfileComplete: true,
      }),
    ).toBe('/onboarding/role');
  });
});

describe('shouldDelayRedirectForNotice', () => {
  it('안내를 준 화면에서 미배정 사용자는 안내를 읽은 뒤 이동한다', () => {
    expect(shouldDelayRedirectForNotice('unassigned', true)).toBe(true);
  });

  it('안내를 주지 않은 화면은 기존대로 즉시 이동한다', () => {
    expect(shouldDelayRedirectForNotice('unassigned', false)).toBe(false);
  });

  // 비로그인은 랜딩 자체가 로그인 안내라 지체시킬 이유가 없고, loading·error·
  // assigned는 애초에 이동하지 않거나 각자의 화면을 띄운다.
  it.each(['anonymous', 'loading', 'error', 'assigned'] as const)(
    '%s 상태는 안내가 있어도 지체시키지 않는다',
    (status) => {
      expect(shouldDelayRedirectForNotice(status, true)).toBe(false);
    },
  );
});
