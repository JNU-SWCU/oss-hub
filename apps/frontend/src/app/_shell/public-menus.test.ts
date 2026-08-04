// 공개 메뉴는 상단 Nav 전담. 사이드바에 넣었다가 갈라지거나 로그인 후
// 랭킹이 사라지던 사고(#513)를 막는다.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_MENU } from './public-menus';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import { sidebarGroupsFor } from './sidebar-menu';

const LAYOUT_PATH = path.resolve(__dirname, '../layout.tsx');
const layoutSource = readFileSync(LAYOUT_PATH, 'utf-8');

describe('공개 메뉴 단일 원본 (상단 전담)', () => {
  it('목록이 비어 있지 않다', () => {
    expect(PUBLIC_MENU.length).toBeGreaterThanOrEqual(3);
  });

  it('랜딩·업무 레이아웃이 원본을 그대로 넘긴다', () => {
    expect(layoutSource).toContain(
      "import { PUBLIC_MENU } from './_shell/public-menus'",
    );
    expect(layoutSource).toContain('items={PUBLIC_MENU}');
  });

  it('레이아웃에 손으로 적은 메뉴 항목이 없다', () => {
    expect(layoutSource).not.toMatch(/href:\s*'/);
  });

  it('역할 메뉴·설정은 공개 목록에 없다', () => {
    const publicHrefs = PUBLIC_MENU.map((item) => item.href);
    for (const item of [...STUDENT_MENU, ...STAFF_MENU, ...ADMIN_MENU]) {
      expect(publicHrefs, item.label).not.toContain(item.href);
    }
    expect(publicHrefs).not.toContain('/settings');
  });

  it('사이드바에는 아카이브·랭킹이 없다 — 상단 전담 (프로그램 상태 필터는 패널)', () => {
    for (const role of ['STUDENT', 'STAFF', 'ADMIN'] as const) {
      const hrefs = sidebarGroupsFor(role).flatMap((g) =>
        g.items.map((i) => i.href),
      );
      expect(hrefs).not.toContain('/archive');
      expect(hrefs).not.toContain('/ranking');
      // 프로그램 목록 입구·status 필터는 사이드 패널에 있다
      expect(hrefs.some((h) => h === '/programs' || h.startsWith('/programs?'))).toBe(
        true,
      );
    }
  });

  it('`/`는 브랜드 링크로만 남는다', () => {
    expect(PUBLIC_MENU.map((item) => item.href)).not.toContain('/');
  });
});
