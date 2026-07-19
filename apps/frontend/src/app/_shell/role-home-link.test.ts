import { describe, expect, it } from 'vitest';
import { resolveRoleHome, ROLE_HOME_LABEL } from './role-home-link';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';

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

describe('ROLE_HOME_LABEL', () => {
  it('role-menus.ts의 역할별 첫 메뉴 라벨과 일치한다', () => {
    expect(ROLE_HOME_LABEL.STUDENT).toBe(STUDENT_MENU[0].label);
    expect(ROLE_HOME_LABEL.STAFF).toBe(STAFF_MENU[0].label);
    expect(ROLE_HOME_LABEL.ADMIN).toBe(ADMIN_MENU[0].label);
  });
});
