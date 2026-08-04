import { describe, expect, it } from 'vitest';
import { ARCHIVE_CATEGORIES } from '@/features/archive/types';
import { SECTION_FACETS } from './section-facets';
import { STUDENT_MENU } from './role-menus';
import {
  archiveSidebarGroup,
  isCurrentSidebarItem,
  programSidebarGroup,
  rankingSidebarGroup,
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

  it('program filters are flat peers with distinct icons', () => {
    const items = programSidebarGroup().items;
    expect(items.every((i) => (i.depth ?? 0) === 0)).toBe(true);
    expect(items.map((i) => i.label)).toEqual([
      '전체',
      '모집중',
      '진행중',
      '접수대기',
      '종료',
    ]);
    const icons = items.map((i) => i.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });

  it('anonymous still sees programs menu', () => {
    expect(sidebarGroupsFor('programs', null)[0]?.items).toHaveLength(5);
  });

  it('dashboard section is role menus only including activity', () => {
    const groups = sidebarGroupsFor('dashboard', 'STUDENT');
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('대시보드');
    expect(
      groups[0]?.items.map(({ label, href }) => ({ label, href })),
    ).toEqual(STUDENT_MENU);
    expect(groups[0]?.items.map((i) => i.href)).toContain(
      '/dashboard/activity',
    );
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

  it('archive section is flat with distinct category icons', () => {
    const groups = sidebarGroupsFor('archive', null);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('공개 아카이브');
    const items = groups[0]?.items ?? [];
    expect(items).toHaveLength(1 + ARCHIVE_CATEGORIES.length);
    expect(items.every((i) => (i.depth ?? 0) === 0)).toBe(true);
    expect(items[0]).toMatchObject({
      label: '전체',
      href: '/archive',
      icon: 'archive',
    });
    expect(items.some((i) => i.href === '/archive?category=CAPSTONE')).toBe(
      true,
    );
    const categoryIcons = items.slice(1).map((i) => i.icon);
    expect(new Set(categoryIcons).size).toBe(categoryIcons.length);
  });

  it('archive counts inject badges', () => {
    const group = archiveSidebarGroup({
      all: 3,
      BASIC: 1,
      CAPSTONE: 2,
    });
    expect(group.items[0]?.count).toBe(3);
    expect(
      group.items.find((i) => i.href === '/archive?category=CAPSTONE')?.count,
    ).toBe(2);
  });

  it('ranking section: 전체 + years as flat peers', () => {
    const groups = sidebarGroupsFor('ranking', null, {
      rankingYears: [2026, 2025],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe('랭킹');
    expect(
      groups[0]?.items.map((i) => ({
        label: i.label,
        href: i.href,
        depth: i.depth,
      })),
    ).toEqual([
      { label: '전체', href: '/ranking', depth: 0 },
      { label: '2026', href: '/ranking?year=2026', depth: 0 },
      { label: '2025', href: '/ranking?year=2025', depth: 0 },
    ]);
  });

  it('ranking without years still has 전체', () => {
    const items = rankingSidebarGroup().items;
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe('전체');
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

  it('archive category query', () => {
    expect(isCurrentSidebarItem('/archive', '/archive', '')).toBe(true);
    expect(
      isCurrentSidebarItem(
        '/archive',
        '/archive?category=CAPSTONE',
        'category=CAPSTONE',
      ),
    ).toBe(true);
    expect(
      isCurrentSidebarItem(
        '/archive',
        '/archive?category=CAPSTONE',
        'category=BASIC',
      ),
    ).toBe(false);
  });

  it('ranking year query', () => {
    expect(isCurrentSidebarItem('/ranking', '/ranking', '')).toBe(true);
    expect(
      isCurrentSidebarItem('/ranking', '/ranking?year=2025', 'year=2025'),
    ).toBe(true);
    expect(isCurrentSidebarItem('/ranking', '/ranking?year=2025', '')).toBe(
      false,
    );
    expect(isCurrentSidebarItem('/ranking', '/ranking', 'year=2025')).toBe(
      false,
    );
  });

  it('archive detail does not highlight 전체; category peers highlight', () => {
    expect(isCurrentSidebarItem('/archive/123', '/archive', '')).toBe(false);
    expect(
      isCurrentSidebarItem('/archive/123', '/archive?category=CAPSTONE', ''),
    ).toBe(true);
  });
});

describe('SECTION_FACETS registry (U4)', () => {
  it('ranking.items(undefined) returns only 전체', () => {
    const items = SECTION_FACETS.ranking?.items(undefined) ?? [];
    expect(items).toHaveLength(1);
    expect(items[0]?.label).toBe('전체');
    expect(items[0]?.href).toBe('/ranking');
  });

  it('registry params match peer-filter keys', () => {
    expect(SECTION_FACETS.programs?.param).toBe('status');
    expect(SECTION_FACETS.archive?.param).toBe('category');
    expect(SECTION_FACETS.ranking?.param).toBe('year');
    expect(SECTION_FACETS.dashboard).toBeUndefined();
  });
});
