import { describe, expect, it } from 'vitest';
import { resolveRoleHome } from './role-home-link';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import { roleHomePath } from './role';

// 역할 홈 nav 링크(#136) 노출 조건: role이 확정된 로그인 사용자만 자기
// 역할 홈으로 이동할 수 있다. 비로그인(401 → anonymous)·역할 미확정·확인
// 중은 대상이 없다 — 자동 리다이렉트(#144)는 back-trap 문제로 제거됐다.
describe('resolveRoleHome', () => {
  it.each([
    ['STUDENT', '/dashboard'],
    ['STAFF', '/staff/dashboard'],
    ['ADMIN', '/admin/staff-requests'],
  ] as const)(
    'role이 확정된(assigned) %s는 role 홈 경로를 반환한다',
    (role, expected) => {
      expect(resolveRoleHome('assigned', role)).toBe(expected);
    },
  );

  it('비로그인(anonymous, 401 포함)은 이동 대상이 없다', () => {
    expect(resolveRoleHome('anonymous', null)).toBeNull();
  });

  it('역할 미확정(unassigned)은 이동 대상이 없다', () => {
    expect(resolveRoleHome('unassigned', null)).toBeNull();
  });

  it('세션 확인 중(loading)은 이동 대상이 없다', () => {
    expect(resolveRoleHome('loading', null)).toBeNull();
  });
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
