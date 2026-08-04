import { describe, expect, it } from 'vitest';
import { resolveSessionEntry } from './role-home-link';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import { roleHomePath } from './role';

describe('resolveSessionEntry', () => {
  // 조회 실패 시에는 역할을 모르므로 nav 진입 링크를 만들 수 없다. 실패 표시와
  // 재시도는 본문 게이트가 담당한다 — nav에도 띄우면 경고가 중복된다.
  it('조회 실패 상태에서는 진입 링크를 만들지 않는다', () => {
    expect(resolveSessionEntry('error', null, false)).toBeNull();
  });

  it.each([
    ['STUDENT', '/dashboard', '내 대시보드'],
    ['STAFF', '/dashboard', '운영 대시보드'],
    ['ADMIN', '/dashboard', '관리 콘솔'],
  ] as const)(
    'role이 확정된(assigned) %s는 회원 공통 대시보드 입구를 반환한다(랜딩 CTA 등)',
    (role, href, label) => {
      const destination = resolveSessionEntry('assigned', role, true);

      expect(destination).toEqual({ href, label, compactLabel: '대시보드' });
    },
  );

  // 온보딩을 끝내지 못한 사용자에게 별도의 "이어서" 행동을 만들지 않는다.
  // 비로그인 방문자와 같은 버튼 하나를 주고, 재개 지점 판단은 `/signup`이 한다.
  it('역할 미확정 사용자도 가입·로그인 진입으로 보낸다', () => {
    const destination = resolveSessionEntry('unassigned', null, false);

    expect(destination).toEqual({
      href: '/signup',
      label: '회원가입 / 로그인',
      compactLabel: '회원가입',
    });
  });

  // 학생은 역할을 고르는 즉시 배정되므로 프로필 단계에서 창을 닫으면 역할만 남는다.
  // 그 사람에게 역할 홈을 내밀면 헤더가 회원의 것이 되고, 눌러도 게이트가 프로필로
  // 되돌려 고장으로 읽힌다. 남은 단계로 데려가는 버튼 하나만 준다.
  it.each(['STUDENT', 'STAFF', 'ADMIN'] as const)(
    '프로필을 마치지 않은 %s에게는 역할 홈 대신 가입·로그인 진입을 준다',
    (role) => {
      const destination = resolveSessionEntry('assigned', role, false);

      expect(destination).toEqual({
        href: '/signup',
        label: '회원가입 / 로그인',
        compactLabel: '회원가입',
      });
    },
  );

  // 비로그인은 같은 actions 슬롯의 LoginButton이 이미 맡고 있어 nav 링크를 하나 더
  // 내지 않는다. 랜딩 본문의 주 행동은 landing-entry-action이 따로 그린다.
  it.each(['anonymous', 'loading'] as const)(
    '%s 상태는 nav 이동 대상을 노출하지 않는다',
    (status) => {
      const destination = resolveSessionEntry(status, null, false);

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
