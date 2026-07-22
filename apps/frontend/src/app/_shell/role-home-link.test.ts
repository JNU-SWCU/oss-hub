import { describe, expect, it } from 'vitest';
import { resolveSessionEntry } from './role-home-link';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import { roleHomePath } from './role';

describe('resolveSessionEntry', () => {
  it.each([
    ['STUDENT', '/dashboard', '내 대시보드'],
    ['STAFF', '/staff/dashboard', '운영 대시보드'],
    ['ADMIN', '/admin/staff-requests', '교직원 승인'],
  ] as const)(
    'role이 확정된(assigned) %s는 role 홈 경로를 반환한다',
    (role, href, label) => {
      const destination = resolveSessionEntry('assigned', role);

      expect(destination).toEqual({ href, label });
    },
  );

  it('역할 미확정 사용자는 필수 동의에서 온보딩을 계속한다', () => {
    const destination = resolveSessionEntry('unassigned', null);

    expect(destination).toEqual({
      href: '/consent',
      label: '가입 계속하기',
    });
  });

  it.each(['anonymous', 'loading'] as const)(
    '%s 상태는 이동 대상을 노출하지 않는다',
    (status) => {
      const destination = resolveSessionEntry(status, null);

      expect(destination).toBeNull();
    },
  );
});

// "역할별 첫 메뉴 = 역할 홈"은 role.ts(roleHomePath)·role-menus.ts(각 MENU[0])·
// nav 링크(RoleHomeNavLink)를 묶는 실제 불변식이다. ROLE_HOME_LABEL은 이제
// role-menus.ts에서 파생되므로(role-home-link.tsx) 별도로 동등성을 검증할
// 필요가 없다 — 대신 이 불변식 자체가 깨지지 않는지 검증한다.
describe('역할별 첫 메뉴 href = 역할 홈 경로', () => {
  it('STUDENT_MENU의 첫 메뉴 href는 roleHomePath(STUDENT)와 같다', () => {
    expect(STUDENT_MENU[0].href).toBe(roleHomePath('STUDENT'));
  });

  it('STAFF_MENU의 첫 메뉴 href는 roleHomePath(STAFF)와 같다', () => {
    expect(STAFF_MENU[0].href).toBe(roleHomePath('STAFF'));
  });

  it('ADMIN_MENU의 첫 메뉴 href는 roleHomePath(ADMIN)와 같다', () => {
    expect(ADMIN_MENU[0].href).toBe(roleHomePath('ADMIN'));
  });
});
