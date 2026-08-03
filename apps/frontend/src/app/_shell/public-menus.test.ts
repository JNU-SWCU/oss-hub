// 공개 메뉴가 랜딩 헤더와 업무 사이드바에 손으로 각각 적혀 있다가 갈라진 사고가
// 실제로 있었다(#513): 같은 화면을 한쪽은 `아카이브`, 다른 쪽은 `공개 아카이브`로
// 불렀고, 사이드바에는 `/ranking`이 아예 없어 로그인한 사용자에게 랭킹으로 가는
// 길이 없었다. 여기서 지키는 불변식은 하나다 —
// **두 셸이 드러내는 공개 목적지가 같다.**
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUBLIC_MENU } from './public-menus';
import { ADMIN_MENU, STAFF_MENU, STUDENT_MENU } from './role-menus';
import { PUBLIC_GROUP, sidebarGroupsFor } from './sidebar-menu';

const ROLES = ['STUDENT', 'STAFF', 'ADMIN'] as const;

/**
 * 랜딩 헤더 쪽은 `layout.tsx`가 `PUBLIC_MENU`를 그대로 넘기는지로 확인한다.
 * 루트 레이아웃은 `next/font`·전역 CSS를 끌고 와 단위 테스트에서 렌더할 대상이
 * 아니므로, 원본을 텍스트로 읽어 배선을 본다 — `audit-log/action-registry.test.ts`,
 * `app/globals.css.test.ts`와 같은 방식이다.
 */
const LAYOUT_PATH = path.resolve(__dirname, '../layout.tsx');
const layoutSource = readFileSync(LAYOUT_PATH, 'utf-8');

describe('공개 메뉴 단일 원본', () => {
  it('목록이 비어 있지 않다 — 아래 비교들이 조용히 공허해지지 않는다', () => {
    expect(PUBLIC_MENU.length).toBeGreaterThanOrEqual(3);
  });

  it('사이드바의 공개 묶음은 라벨·경로를 원본에서 그대로 가져온다', () => {
    expect(
      PUBLIC_GROUP.items.map(({ label, href }) => ({ label, href })),
    ).toEqual(PUBLIC_MENU);
  });

  it('랜딩 헤더는 원본을 그대로 넘긴다', () => {
    expect(layoutSource).toContain(
      "import { PUBLIC_MENU } from './_shell/public-menus'",
    );
    expect(layoutSource).toContain('items={PUBLIC_MENU}');
  });

  // 갈라짐은 늘 "여기서 한 줄만 더 적자"로 시작한다.
  it('랜딩 헤더에 손으로 적은 메뉴 항목이 남아 있지 않다', () => {
    expect(layoutSource).not.toMatch(/href:\s*'/);
  });

  it('공개 메뉴에 아이콘이 모두 붙는다 — 접힌 사이드바에서는 이것만 보고 이동한다', () => {
    for (const item of PUBLIC_GROUP.items) {
      expect(item.icon, item.href).toBeTruthy();
    }
  });

  // #513의 실제 증상: 로그인하면 랭킹으로 갈 방법이 사라졌다.
  it.each(ROLES)('%s 사이드바에도 공개 목적지가 빠짐없이 있다', (role) => {
    const hrefs = sidebarGroupsFor(role).flatMap((group) =>
      group.items.map((item) => item.href),
    );

    for (const item of PUBLIC_MENU) {
      expect(hrefs, item.label).toContain(item.href);
    }
  });

  /**
   * 공유되는 것은 공개 화면뿐이다(#512). 역할 메뉴·계정을 랜딩 헤더로 끌어올리면
   * 아직 가입도 하지 않은 방문자에게 눌러도 튕기는 메뉴를 내미는 셈이 된다.
   */
  it('역할 메뉴는 공개 목록에 올라오지 않는다', () => {
    const publicHrefs = PUBLIC_MENU.map((item) => item.href);

    for (const item of [...STUDENT_MENU, ...STAFF_MENU, ...ADMIN_MENU]) {
      expect(publicHrefs, item.label).not.toContain(item.href);
    }
    expect(publicHrefs).not.toContain('/settings');
  });

  /**
   * `/`는 두 셸 모두 브랜드(`OSS Hub`)가 이미 링크로 갖고 있다. 목록에 `홈`을 또
   * 두면 랜딩 헤더에는 같은 목적지 링크가 둘이 되고, 사이드바에서는 `home` 아이콘이
   * `내 대시보드`와 겹쳐 접힌 사이드바에서 같은 그림이 두 곳을 가리킨다.
   */
  it('`/`는 메뉴 항목이 아니라 브랜드 링크로 남는다', () => {
    expect(PUBLIC_MENU.map((item) => item.href)).not.toContain('/');
    expect(layoutSource).toContain('brand={<Link href="/">OSS Hub</Link>}');
  });
});
