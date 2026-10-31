import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import { isCurrentSection, SECTIONS, sectionItemsFor } from './section-list';
import { sidebarGroupsFor } from './sidebar-menu';

const LAYOUT_PATH = path.resolve(__dirname, '../layout.tsx');
const layoutSource = readFileSync(LAYOUT_PATH, 'utf-8');

const GUEST = { status: 'anonymous', isProfileComplete: false } as const;
const MEMBER = { status: 'assigned', isProfileComplete: true } as const;

describe('섹션 목록 단일 원본', () => {
  it('공개 섹션은 프로그램·랭킹 순서이고 아이콘을 품는다', () => {
    expect(SECTIONS.map((item) => [item.id, item.href])).toEqual([
      ['programs', '/programs'],
      ['ranking', '/ranking'],
    ]);
    expect(SECTIONS.map((item) => item.icon)).toEqual(['list', 'chart']);
  });

  it('레이아웃은 메뉴 항목을 넘기지 않고 셸이 원본에서 읽는다', () => {
    expect(layoutSource).not.toContain('items=');
    expect(layoutSource).not.toMatch(/href:\s*'/);
  });

  it('가입을 마친 회원에게만 대시보드가 마지막에 붙는다', () => {
    expect(sectionItemsFor(GUEST)).toBe(SECTIONS);
    expect(
      sectionItemsFor({ status: 'assigned', isProfileComplete: false }),
    ).toBe(SECTIONS);
    expect(
      sectionItemsFor({ status: 'unassigned', isProfileComplete: true }),
    ).toBe(SECTIONS);

    const member = sectionItemsFor(MEMBER);
    expect(member.map((item) => item.id)).toEqual([
      'programs',
      'ranking',
      'dashboard',
    ]);
    expect(member.at(-1)).toMatchObject({
      label: '대시보드',
      href: '/dashboard',
      icon: 'home',
    });
  });

  it('역할 메뉴·설정은 섹션 목록에 없고 `/`는 브랜드 링크로만 남는다', () => {
    const hrefs = sectionItemsFor(MEMBER).map((item) => item.href);
    for (const item of [...STUDENT_MENU, ...STAFF_MENU, ...ADMIN_MENU]) {
      if (item.href === '/dashboard') continue;
      expect(hrefs, item.label).not.toContain(item.href);
    }
    expect(hrefs).not.toContain('/settings');
    expect(hrefs).not.toContain('/');
  });

  it('프로그램 섹션 좌측에는 상태 필터만 있고 랭킹 href는 없다', () => {
    const hrefs = sidebarGroupsFor('programs', {
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
    }).flatMap((g) => g.items.map((i) => i.href));
    expect(
      hrefs.some((h) => h === '/programs' || h.startsWith('/programs?')),
    ).toBe(true);
    expect(hrefs).not.toContain('/ranking');
  });

  it('현재 섹션은 셸 섹션 판정을 따른다 — 하위 경로와 /my-repos 포함', () => {
    expect(isCurrentSection('/programs/abc/teams', 'programs')).toBe(true);
    expect(isCurrentSection('/ranking', 'ranking')).toBe(true);
    expect(isCurrentSection('/my-repos', 'dashboard')).toBe(true);
    expect(isCurrentSection('/dashboard/users', 'dashboard')).toBe(true);
    expect(isCurrentSection('/programs', 'ranking')).toBe(false);
    expect(isCurrentSection('/', 'programs')).toBe(false);
  });
});
