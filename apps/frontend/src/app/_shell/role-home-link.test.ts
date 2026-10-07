import { describe, expect, it } from 'vitest';
import { resolveSessionEntry } from './role-home-link';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import { roleHomePath } from './role';

describe('resolveSessionEntry', () => {
  it('조회 실패 상태에서는 진입 링크를 만들지 않는다', () => {
    expect(resolveSessionEntry('error', null, false)).toBeNull();
  });

  it.each([
    [
      'STUDENT',
      { memberKind: 'STUDENT', hasStaffAccess: false, hasAdminAccess: false },
      '내 대시보드',
    ],
    [
      'STAFF',
      { memberKind: 'STAFF', hasStaffAccess: true, hasAdminAccess: false },
      '운영 대시보드',
    ],
  ] as const)('회원 유형 %s는 대시보드 입구를 반환한다', (_, access, label) => {
    expect(resolveSessionEntry('assigned', access, true)).toEqual({
      href: '/dashboard',
      label,
      compactLabel: '대시보드',
    });
  });

  it('admin-only 호환 사용자는 관리자 화면 입구를 반환한다', () => {
    expect(
      resolveSessionEntry(
        'assigned',
        { memberKind: null, hasStaffAccess: false, hasAdminAccess: true },
        true,
      ),
    ).toEqual({
      href: '/dashboard/users',
      label: '사용자 목록',
      compactLabel: '관리',
    });
  });

  it('역할 미확정 사용자도 가입·로그인 진입으로 보낸다', () => {
    const destination = resolveSessionEntry('unassigned', null, false);

    expect(destination).toEqual({
      href: '/signup',
      label: '로그인',
      compactLabel: '로그인',
    });
  });

  it.each([
    { memberKind: 'STUDENT', hasStaffAccess: false, hasAdminAccess: false },
    { memberKind: 'STAFF', hasStaffAccess: true, hasAdminAccess: false },
    { memberKind: null, hasStaffAccess: false, hasAdminAccess: true },
  ] as const)(
    '프로필을 마치지 않은 canonical 회원은 역할 홈 대신 가입·로그인 진입을 준다',
    (access) => {
      const destination = resolveSessionEntry('assigned', access, false);

      expect(destination).toEqual({
        href: '/signup',
        label: '로그인',
        compactLabel: '로그인',
      });
    },
  );

  it.each(['anonymous', 'loading'] as const)(
    '%s 상태는 nav 이동 대상을 노출하지 않는다',
    (status) => {
      const destination = resolveSessionEntry(status, null, false);

      expect(destination).toBeNull();
    },
  );
});

describe('역할별 첫 메뉴 href = 역할 홈 경로', () => {
  it('STUDENT_MENU의 첫 메뉴 href는 roleHomePath()와 같다', () => {
    expect(STUDENT_MENU[0].href).toBe(roleHomePath());
  });

  it('STAFF_MENU의 첫 메뉴 href는 roleHomePath()와 같다', () => {
    expect(STAFF_MENU[0].href).toBe(roleHomePath());
  });

  it('ADMIN_MENU의 첫 메뉴 href는 roleHomePath()와 같다', () => {
    expect(ADMIN_MENU[0].href).toBe(roleHomePath());
  });
});
