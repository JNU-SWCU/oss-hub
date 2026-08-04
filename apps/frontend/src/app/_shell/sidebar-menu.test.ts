import { describe, expect, it } from 'vitest';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import { isCurrentSidebarItem, sidebarGroupsFor } from './sidebar-menu';

const ROLES = ['STUDENT', 'STAFF', 'ADMIN'] as const;

describe('sidebarGroupsFor', () => {
  it('역할을 모르면 빈 배열 — 사이드바를 달지 않는다', () => {
    expect(sidebarGroupsFor(null)).toEqual([]);
  });

  it('역할 메뉴의 라벨·경로는 role-menus.ts에서 그대로 온다', () => {
    const student = sidebarGroupsFor('STUDENT')[0];
    const staff = sidebarGroupsFor('STAFF')[0];
    const admin = sidebarGroupsFor('ADMIN')[0];

    expect(student?.items.map(({ label, href }) => ({ label, href }))).toEqual(
      STUDENT_MENU,
    );
    expect(staff?.items.map(({ label, href }) => ({ label, href }))).toEqual(
      STAFF_MENU,
    );
    expect(admin?.items.map(({ label, href }) => ({ label, href }))).toEqual(
      ADMIN_MENU,
    );
  });

  it('공개·설정 경로를 사이드바에 넣지 않는다', () => {
    for (const role of ROLES) {
      const hrefs = sidebarGroupsFor(role).flatMap((g) =>
        g.items.map((i) => i.href),
      );
      expect(hrefs).not.toContain('/programs');
      expect(hrefs).not.toContain('/archive');
      expect(hrefs).not.toContain('/ranking');
      expect(hrefs).not.toContain('/settings');
    }
  });

  it('모든 메뉴에 아이콘이 있다', () => {
    for (const role of ROLES) {
      for (const group of sidebarGroupsFor(role)) {
        for (const item of group.items) {
          expect(item.icon, `${role} / ${item.href}`).toBeTruthy();
        }
      }
    }
  });

  it('학생 구역 라벨은 내 상황이다', () => {
    expect(sidebarGroupsFor('STUDENT')[0]?.label).toBe('내 상황');
  });
});

describe('isCurrentSidebarItem', () => {
  it('정확히 같은 경로는 현재 위치다', () => {
    expect(isCurrentSidebarItem('/dashboard', '/dashboard')).toBe(true);
  });

  it('하위 경로도 그 메뉴의 현재 위치로 본다', () => {
    expect(isCurrentSidebarItem('/dashboard/activity', '/dashboard')).toBe(
      true,
    );
  });

  it('접두사가 같아 보여도 경로 경계가 다르면 현재 위치가 아니다', () => {
    expect(isCurrentSidebarItem('/programs-archive', '/programs')).toBe(false);
    expect(isCurrentSidebarItem('/staff/programs/new', '/programs')).toBe(
      false,
    );
  });
});
