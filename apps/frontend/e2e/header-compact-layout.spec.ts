import { expect, test, type Page } from '@playwright/test';

import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';

const PRODUCT_MOBILE_WIDTHS = [320, 390, 768, 899] as const;
const PRODUCT_DESKTOP_WIDTHS = [900, 1440] as const;
const SECTION_TABS = ['프로그램', '랭킹', '대시보드'] as const;

function expectNoFoldedNavigation(page: Page, width: number) {
  return Promise.all([
    expect(
      page.locator('[data-slot="nav-bar-menu-trigger"]'),
      `폭 ${width}px의 접힌 헤더 메뉴`,
    ).toHaveCount(0),
    expect(
      page.locator('[data-slot="nav-bar-sidebar-drawer-trigger"]'),
      `폭 ${width}px의 사이드바 서랍 열기`,
    ).toHaveCount(0),
    expect(
      page.getByRole('button', { name: '사이드바 메뉴 열기', exact: true }),
      `폭 ${width}px의 사이드바 메뉴 열기`,
    ).toHaveCount(0),
  ]);
}

for (const multipleAuthorities of [false, true]) {
  test(`좁은 제품 화면은 하단 탭 막대 하나로 이동하고 계정과 겹치지 않는다: ${multipleAuthorities ? '복합 권한' : '학생'}`, async ({
    page,
  }, testInfo) => {
    test.slow();
    await installSyntheticAuthority(
      page,
      {
        role: multipleAuthorities ? 'ADMIN' : 'STUDENT',
        memberKind: 'STUDENT',
        hasStaffAccess: multipleAuthorities,
        hasAdminAccess: multipleAuthorities,
      },
      {
        'GET /api/v1/dashboard/student': async (route) => {
          await fulfillJson(route, { items: [] });
        },
        'GET /api/v1/dashboard/student/feedback': async (route) => {
          await fulfillJson(route, { items: [] });
        },
        'GET /api/v1/users/me/notifications/application-decisions': async (
          route,
        ) => {
          await fulfillJson(route, []);
        },
        'GET /api/v1/users/me/notifications/team-deletions': async (route) => {
          await fulfillJson(route, []);
        },
        'GET /api/v1/team-invitations/received': async (route) => {
          await fulfillJson(route, []);
        },
        'GET /api/v1/dashboard/staff/summary': async (route) => {
          await fulfillJson(route, { programs: [] });
        },
      },
    );
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto('/dashboard');
    const tabBar = page.locator('[data-slot="bottom-tab-bar"]');
    const tabs = tabBar.getByRole('link');
    const invitations = page.getByRole('button', {
      name: '팀 초대 알림',
      exact: true,
    });
    await expect(invitations).toBeVisible();
    await expect(tabBar).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('header-320.png') });

    for (const width of PRODUCT_MOBILE_WIDTHS) {
      await page.setViewportSize({ width, height: 844 });
      await expect(tabBar, `폭 ${width}px의 하단 탭 막대`).toHaveCount(1);
      await expect(tabBar).toBeVisible();
      await expectNoFoldedNavigation(page, width);
      await expect(tabs).toHaveText([...SECTION_TABS]);
      await expect(
        tabBar.getByRole('link', { name: '대시보드', exact: true }),
      ).toHaveAttribute('aria-current', 'page');
      const barBox = await tabBar.boundingBox();
      const invitationBox = await invitations.boundingBox();
      if (barBox === null || invitationBox === null) {
        throw new Error('하단 탭 막대나 헤더 버튼이 보이지 않습니다.');
      }
      expect(barBox.x).toBe(0);
      expect(barBox.width).toBe(width);
      expect(Math.round(barBox.y + barBox.height)).toBe(844);
      for (const tab of await tabs.all()) {
        const tabBox = await tab.boundingBox();
        if (tabBox === null) throw new Error('하단 탭이 보이지 않습니다.');
        expect(tabBox.height, `폭 ${width}px의 탭 높이`).toBeGreaterThanOrEqual(
          44,
        );
      }
      expect(invitationBox.x + invitationBox.width).toBeLessThanOrEqual(width);
      expect(invitationBox.width).toBeGreaterThanOrEqual(44);
      expect(invitationBox.height).toBeGreaterThanOrEqual(44);
    }

    for (const width of PRODUCT_DESKTOP_WIDTHS) {
      await page.setViewportSize({ width, height: 900 });
      await expect(tabBar).toBeHidden();
      await expectNoFoldedNavigation(page, width);
      await expect(page.locator('[data-slot="nav-bar-items"]')).toBeVisible();
    }

    await page.setViewportSize({ width: 320, height: 844 });
    await page
      .getByRole('button', { name: /synthetic-member-access 계정 메뉴/ })
      .click();
    const accountMenu = page.getByRole('menu', {
      name: '계정 메뉴',
      exact: true,
    });
    await expect(accountMenu).toBeVisible();
    const accountBox = await accountMenu.boundingBox();
    if (accountBox === null) throw new Error('계정 메뉴가 보이지 않습니다.');
    expect(accountBox.x).toBeGreaterThanOrEqual(0);
    expect(accountBox.x + accountBox.width).toBeLessThanOrEqual(320);
    await page.screenshot({
      path: testInfo.outputPath('account-menu-320.png'),
    });
  });
}

for (const pathname of ['/']) {
  test(`가입 전 화면 ${pathname}의 접힌 헤더 메뉴는 그대로 열고 닫힌다`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(pathname);
    const menu = page.locator('[data-slot="nav-bar-menu-trigger"]');
    const menuDetails = page.locator('[data-slot="nav-bar-menu"]');
    const menuItems = page.locator('[data-slot="nav-bar-menu-items"]');
    await expect(menu).toBeVisible();
    await expect(page.locator('[data-slot="bottom-tab-bar"]')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath(
        `pre-member-${pathname === '/' ? 'landing' : 'signup'}-320.png`,
      ),
    });

    for (const width of [320, 390, 480]) {
      await page.setViewportSize({ width, height: 844 });
      const menuBox = await menu.boundingBox();
      if (menuBox === null) throw new Error('헤더 메뉴가 보이지 않습니다.');
      expect(menuBox.width).toBeGreaterThanOrEqual(44);
      expect(menuBox.height).toBeGreaterThanOrEqual(44);
      await menu.click();
      await expect(menuDetails).toHaveAttribute('open', '');
      const menuItemsBox = await menuItems.boundingBox();
      if (menuItemsBox === null)
        throw new Error('탐색 메뉴가 보이지 않습니다.');
      expect(
        menuItemsBox.x,
        `폭 ${width}px의 메뉴 왼쪽`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        menuItemsBox.x + menuItemsBox.width,
        `폭 ${width}px의 메뉴 오른쪽`,
      ).toBeLessThanOrEqual(width);
      await page.keyboard.press('Escape');
      await expect(menuDetails).not.toHaveAttribute('open', '');
      await expect(menu).toBeFocused();
    }

    for (const width of [481, 639]) {
      await page.setViewportSize({ width, height: 844 });
      await menu.click();
      await expect(menuDetails).toHaveAttribute('open', '');
      const detailsBox = await menuDetails.boundingBox();
      const menuItemsBox = await menuItems.boundingBox();
      if (detailsBox === null || menuItemsBox === null) {
        throw new Error('탐색 메뉴가 보이지 않습니다.');
      }
      expect(menuItemsBox.x).toBe(detailsBox.x);
      expect(menuItemsBox.width).toBe(208);
      await page.keyboard.press('Escape');
      await expect(menuDetails).not.toHaveAttribute('open', '');
    }

    for (const width of [640, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(menu).toBeHidden();
      await expect(page.locator('[data-slot="nav-bar-items"]')).toBeVisible();
    }
  });
}
