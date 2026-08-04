import { describe, expect, it } from 'vitest';
import { STUDENT_MENU } from './role-menus';
import {
  isCurrentSidebarItem,
  programSidebarGroup,
  shellSectionFromPathname,
  sidebarGroupsFor,
} from './sidebar-menu';

describe('shellSectionFromPathname', () => {
  it('maps paths to sections', () => {
    expect(shellSectionFromPathname('/programs')).toBe('programs');
    expect(shellSectionFromPathname('/programs/x')).toBe('programs');
    expect(shellSectionFromPathname('/archive')).toBe('archive');
    expect(shellSectionFromPathname('/ranking')).toBe('ranking');
    expect(shellSectionFromPathname('/dashboard')).toBe('dashboard');
    expect(shellSectionFromPathname('/my-repos')).toBe('dashboard');
    expect(shellSectionFromPathname('/staff/dashboard')).toBe('dashboard');
    expect(shellSectionFromPathname('/settings')).toBeNull();
  });
});

describe('sidebarGroupsFor (context)', () => {
  it('programs section only — no role menu mixed in', () => {
    const groups = sidebarGroupsFor('programs', 'STUDENT');
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

  it('program depth: all=0 children=1', () => {
    const items = programSidebarGroup().items;
    expect(items[0]?.depth).toBe(0);
    expect(items.slice(1).every((i) => i.depth === 1)).toBe(true);
  });

  it('anonymous still sees programs menu', () => {
    expect(sidebarGroupsFor('programs', null)[0]?.items).toHaveLength(5);
  });

  it('dashboard section is role menus only', () => {
    const groups = sidebarGroupsFor('dashboard', 'STUDENT');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('대시보드');
    expect(
      groups[0]?.items.map(({ label, href }) => ({ label, href })),
    ).toEqual(STUDENT_MENU);
  });

  it('dashboard without role is empty', () => {
    expect(sidebarGroupsFor('dashboard', null)).toEqual([]);
  });

  it('no practice competition item', () => {
    const labels = programSidebarGroup()
      .items.map((i) => i.label)
      .join(' ');
    expect(labels).not.toContain('연습');
  });
});

describe('isCurrentSidebarItem', () => {
  it('program status query', () => {
    expect(isCurrentSidebarItem('/programs', '/programs', '')).toBe(true);
    expect(
      isCurrentSidebarItem(
        '/programs',
        '/programs?status=recruiting',
        'status=recruiting',
      ),
    ).toBe(true);
  });

  it('program detail does not highlight filters', () => {
    expect(isCurrentSidebarItem('/programs/x', '/programs', '')).toBe(false);
  });
});
