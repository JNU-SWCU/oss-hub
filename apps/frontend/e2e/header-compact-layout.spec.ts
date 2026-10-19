import { expect, test } from '@playwright/test';

import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';

for (const multipleAuthorities of [false, true]) {
  test(`좁은 헤더의 메뉴와 계정이 겹치지 않는다: ${multipleAuthorities ? '복합 권한' : '학생'}`, async ({
    page,
  }, testInfo) => {
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
    const menu = page.locator('[data-slot="nav-bar-menu-trigger"]');
    const invitations = page.getByRole('button', {
      name: '팀 초대 알림',
      exact: true,
    });
    await expect(invitations).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('header-320.png') });

    for (let width = 320; width <= 480; width += 1) {
      await page.setViewportSize({ width, height: 844 });
      const menuBox = await menu.boundingBox();
      const invitationBox = await invitations.boundingBox();
      if (menuBox === null || invitationBox === null) {
        throw new Error('헤더 버튼이 보이지 않습니다.');
      }
      expect(
        menuBox.x + menuBox.width,
        `폭 ${width}px의 누름 영역`,
      ).toBeLessThanOrEqual(invitationBox.x);
    }

    await page.setViewportSize({ width: 320, height: 844 });
    await menu.click();
    await expect(page.locator('[data-slot="nav-bar-menu"]')).toHaveAttribute(
      'open',
      '',
    );
    await page.keyboard.press('Escape');
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
