import { describe, expect, it } from 'vitest';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import {
  PUBLIC_GROUP,
  isCurrentSidebarItem,
  shellPageLabel,
  sidebarGroupsFor,
} from './sidebar-menu';

const ROLES = ['STUDENT', 'STAFF', 'ADMIN'] as const;

describe('sidebarGroupsFor', () => {
  // v1에서 공개 화면을 역할 메뉴로 착각해 빼먹었다가 지적받은 지점이다.
  it.each(ROLES)(
    '%s 에게도 공개 화면(프로그램·공개 아카이브)을 보여 준다',
    (role) => {
      const hrefs = sidebarGroupsFor(role).flatMap((group) =>
        group.items.map((item) => item.href),
      );

      expect(hrefs).toContain('/programs');
      expect(hrefs).toContain('/archive');
    },
  );

  it('역할 메뉴의 라벨·경로는 role-menus.ts에서 그대로 온다', () => {
    const student = sidebarGroupsFor('STUDENT')[0];
    const staff = sidebarGroupsFor('STAFF')[0];
    const admin = sidebarGroupsFor('ADMIN')[0];

    expect(student.items.map(({ label, href }) => ({ label, href }))).toEqual(
      STUDENT_MENU,
    );
    expect(staff.items.map(({ label, href }) => ({ label, href }))).toEqual(
      STAFF_MENU,
    );
    expect(admin.items.map(({ label, href }) => ({ label, href }))).toEqual(
      ADMIN_MENU,
    );
  });

  it('모든 메뉴에 아이콘이 있다 — 접힌 사이드바에서는 이것만 보고 이동한다', () => {
    for (const role of ROLES) {
      for (const group of sidebarGroupsFor(role)) {
        for (const item of group.items) {
          expect(item.icon, `${role} / ${item.href}`).toBeTruthy();
        }
      }
    }
  });

  it('역할을 모르는 사용자에게는 공개 묶음만 보여 준다', () => {
    expect(sidebarGroupsFor(null)).toEqual([PUBLIC_GROUP]);
  });

  it('역할별로 계정(설정)까지 세 묶음을 만든다', () => {
    for (const role of ROLES) {
      const labels = sidebarGroupsFor(role).map((group) => group.label);
      expect(labels).toHaveLength(3);
      expect(labels[1]).toBe('둘러보기');
      expect(labels[2]).toBe('계정');
    }
  });
});

describe('isCurrentSidebarItem', () => {
  it('정확히 같은 경로는 현재 위치다', () => {
    expect(isCurrentSidebarItem('/dashboard', '/dashboard')).toBe(true);
  });

  it('하위 경로도 그 메뉴의 현재 위치로 본다', () => {
    expect(isCurrentSidebarItem('/dashboard/activity', '/dashboard')).toBe(true);
    expect(isCurrentSidebarItem('/programs/program-capstone', '/programs')).toBe(
      true,
    );
  });

  it('접두사가 같아 보여도 경로 경계가 다르면 현재 위치가 아니다', () => {
    expect(isCurrentSidebarItem('/programs-archive', '/programs')).toBe(false);
    expect(isCurrentSidebarItem('/staff/programs/new', '/programs')).toBe(false);
  });
});

describe('shellPageLabel', () => {
  it('메뉴 라벨을 그대로 쓴다', () => {
    expect(shellPageLabel('/dashboard')).toBe('내 대시보드');
    expect(shellPageLabel('/archive')).toBe('공개 아카이브');
    expect(shellPageLabel('/settings')).toBe('설정');
  });

  // 짧은 접두사가 먼저 걸리면 `/staff/programs/new`가 `/programs`로 표시된다.
  it('가장 긴 접두사가 이긴다', () => {
    expect(shellPageLabel('/staff/programs/new')).toBe('프로그램 등록');
    expect(shellPageLabel('/admin/system-status')).toBe('시스템 상태');
  });

  it('상세 화면은 그 목록 메뉴의 이름으로 표시한다', () => {
    expect(shellPageLabel('/programs/program-capstone')).toBe('프로그램');
  });

  it('메뉴에 없는 경로는 null이다 — 상단바가 빈 라벨을 그리지 않는다', () => {
    expect(shellPageLabel('/consent')).toBeNull();
    expect(shellPageLabel('/onboarding/role')).toBeNull();
  });
});
