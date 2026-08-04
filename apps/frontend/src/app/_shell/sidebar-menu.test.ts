import { describe, expect, it } from 'vitest';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import {
  PROGRAM_SIDEBAR_GROUP,
  isCurrentSidebarItem,
  sidebarGroupsFor,
} from './sidebar-menu';

const ROLES = ['STUDENT', 'STAFF', 'ADMIN'] as const;

describe('sidebarGroupsFor', () => {
  it('역할이 없어도 프로그램 메뉴는 있다', () => {
    const groups = sidebarGroupsFor(null);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('프로그램 메뉴');
    expect(groups[0]?.items.map((i) => i.label)).toEqual([
      '전체',
      '모집중',
      '진행중',
      '접수대기',
      '종료',
    ]);
  });

  it('가입 완료 역할이면 프로그램 메뉴 뒤에 내 상황이 온다', () => {
    const student = sidebarGroupsFor('STUDENT');
    expect(student.map((g) => g.label)).toEqual(['프로그램 메뉴', '내 상황']);
    expect(
      student[1]?.items.map(({ label, href }) => ({ label, href })),
    ).toEqual(STUDENT_MENU);
    expect(
      sidebarGroupsFor('STAFF')[1]?.items.map(({ label, href }) => ({
        label,
        href,
      })),
    ).toEqual(STAFF_MENU);
    expect(
      sidebarGroupsFor('ADMIN')[1]?.items.map(({ label, href }) => ({
        label,
        href,
      })),
    ).toEqual(ADMIN_MENU);
  });

  it('연습대회 항목이 없다', () => {
    const labels = PROGRAM_SIDEBAR_GROUP.items.map((i) => i.label).join(' ');
    expect(labels).not.toContain('연습');
  });

  it('모든 메뉴에 아이콘이 있다', () => {
    for (const role of [null, ...ROLES] as const) {
      for (const group of sidebarGroupsFor(role)) {
        for (const item of group.items) {
          expect(item.icon, item.href).toBeTruthy();
        }
      }
    }
  });
});

describe('isCurrentSidebarItem', () => {
  it('역할 홈 경로는 접두사로 맞춘다', () => {
    expect(isCurrentSidebarItem('/dashboard', '/dashboard')).toBe(true);
    expect(isCurrentSidebarItem('/dashboard/activity', '/dashboard')).toBe(
      true,
    );
  });

  it('프로그램 상태 필터는 pathname=/programs 와 status 쿼리로 맞춘다', () => {
    expect(isCurrentSidebarItem('/programs', '/programs', '')).toBe(true);
    expect(
      isCurrentSidebarItem('/programs', '/programs?status=recruiting', ''),
    ).toBe(false);
    expect(
      isCurrentSidebarItem(
        '/programs',
        '/programs?status=recruiting',
        'status=recruiting',
      ),
    ).toBe(true);
    expect(
      isCurrentSidebarItem(
        '/programs',
        '/programs?status=ended',
        'status=recruiting',
      ),
    ).toBe(false);
  });

  it('프로그램 상세에서는 상태 필터를 켜지 않는다', () => {
    expect(
      isCurrentSidebarItem('/programs/abc', '/programs', ''),
    ).toBe(false);
    expect(
      isCurrentSidebarItem(
        '/programs/abc',
        '/programs?status=recruiting',
        'status=recruiting',
      ),
    ).toBe(false);
  });
});
