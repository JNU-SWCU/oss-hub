import { describe, expect, it } from 'vitest';
import { resolveRoleHomeRedirect } from './role-home-redirect';

// 랜딩(#136) 리다이렉트 조건: role이 확정된 로그인 사용자만 자기 역할 홈으로
// 보낸다. 비로그인(401 → anonymous)·역할 미확정·확인 중은 랜딩을 유지한다.
describe('resolveRoleHomeRedirect', () => {
  it.each([
    ['STUDENT', '/dashboard'],
    ['STAFF', '/staff/dashboard'],
    ['ADMIN', '/admin/staff-requests'],
  ] as const)(
    'role이 확정된(assigned) %s는 role 홈으로 이동 대상을 반환한다',
    (role, expected) => {
      expect(resolveRoleHomeRedirect('assigned', role)).toBe(expected);
    },
  );

  it('비로그인(anonymous, 401 포함)은 이동 대상이 없다', () => {
    expect(resolveRoleHomeRedirect('anonymous', null)).toBeNull();
  });

  it('역할 미확정(unassigned)은 이동 대상이 없다', () => {
    expect(resolveRoleHomeRedirect('unassigned', null)).toBeNull();
  });

  it('세션 확인 중(loading)은 이동 대상이 없다', () => {
    expect(resolveRoleHomeRedirect('loading', null)).toBeNull();
  });
});
