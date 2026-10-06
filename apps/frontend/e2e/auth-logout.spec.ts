import { expect, test, type Page, type Route } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import {
  F3_LOGOUT_ORIGIN_PATH,
  F3_SAVED_NOTIFICATION,
  F3_SAVED_PROFILE,
  installLogoutFixture,
  type F3ApiHandlers,
} from './support/f3-account-fixture';
import { captureF3Evidence } from './support/f3-evidence';

const ACCOUNT_MENU_LABEL = 'synthetic-f3-account 계정 메뉴';

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

const SETTINGS_ORIGIN_READS: F3ApiHandlers = {
  'GET /api/v1/users/me/profile': (route) =>
    fulfillJson(route, F3_SAVED_PROFILE),
  'GET /api/v1/users/me/notification-email': (route) =>
    fulfillJson(route, F3_SAVED_NOTIFICATION),
  'GET /api/v1/team-invitations/received': (route) => fulfillJson(route, []),
};

const ANONYMOUS_HOME_READS: F3ApiHandlers = {
  'GET /api/v1/programs': (route) => fulfillJson(route, { items: [] }),
  'GET /api/v1/projects': (route) => fulfillJson(route, { items: [] }),
};

async function clickLogout(page: Page): Promise<void> {
  await page.getByRole('button', { name: ACCOUNT_MENU_LABEL }).click();
  await page.getByRole('menuitem', { name: '로그아웃' }).click();
}

test('logout success returns to the anonymous home introduction', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const fixture = await installLogoutFixture(page, 'success', {
    ...SETTINGS_ORIGIN_READS,
    ...ANONYMOUS_HOME_READS,
  });

  await page.goto(F3_LOGOUT_ORIGIN_PATH);
  await clickLogout(page);

  await expect(page).toHaveURL(new URL('/', page.url()).href);
  await expect(
    page.getByRole('heading', { name: '흩어진 정보를 한 곳으로' }),
  ).toBeVisible();
  await expect(
    page
      .locator('[data-slot="nav-bar"]')
      .getByRole('link', { name: '로그인', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: ACCOUNT_MENU_LABEL }),
  ).toHaveCount(0);
  expect(fixture.logoutRequests()).toBe(1);

  await captureF3Evidence(page, testInfo, 'logout-success');
  audit.assertClean();
});

test('logout failure keeps the authenticated view and reports the error', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const fixture = await installLogoutFixture(
    page,
    'failure',
    SETTINGS_ORIGIN_READS,
  );

  await page.goto(F3_LOGOUT_ORIGIN_PATH);
  await clickLogout(page);

  await expect(
    page.getByRole('alert').filter({
      hasText: '로그아웃하지 못했습니다. 잠시 후 다시 시도해 주세요.',
    }),
  ).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(
    page.getByRole('button', { name: ACCOUNT_MENU_LABEL }),
  ).toBeVisible();
  expect(fixture.logoutRequests()).toBe(1);

  await captureF3Evidence(page, testInfo, 'logout-failure');
  audit.assertClean([
    { status: 500, path: '/api/v1/auth/logout', method: 'POST' },
  ]);
});
