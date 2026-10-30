import { expect, test, type Page } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import { authenticatedSessionBody } from './support/session-mock';

const HERO_HEADING = '흩어진 정보를 하나로';

function hero(page: Page) {
  return page.locator('#landing-hero');
}

for (const path of ['/signup', '/logout', '/programs/x/milestones/y/submit']) {
  test(`retired route ${path} returns 404`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(404);
    await expect(page).toHaveURL(new URL(path, page.url()).href);
  });
}

test('signing in from a protected page returns to the stored destination', async ({
  page,
}) => {
  let authenticated = false;
  let oauthRequests = 0;
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        authenticated
          ? authenticatedSessionBody('staff')
          : { isAuthenticated: false },
      ),
    }),
  );
  await page.route('**/api/v1/auth/github', async (route) => {
    oauthRequests += 1;
    authenticated = true;
    await route.fulfill({ status: 302, headers: { location: '/' }, body: '' });
  });

  await page.goto('/dashboard');
  const signIn = page
    .locator('section[aria-labelledby="login-required-heading"]')
    .getByRole('link', { name: 'GitHub으로 로그인', exact: true });
  await expect(signIn).toBeVisible();
  const oauthStart = page.waitForRequest('**/api/v1/auth/github');
  await signIn.click();
  await oauthStart;
  await expect(page).toHaveURL(new URL('/dashboard', page.url()).href);
  await expect(page.locator('#login-required-heading')).toHaveCount(0);
  expect(oauthRequests).toBe(1);
  expect(
    await page.evaluate(() =>
      sessionStorage.getItem('oss-hub-login-destination'),
    ),
  ).toBeNull();
});

test('logged-out landing keeps the hero copy but drops the action row and the notice', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);

  await page.goto('/');
  await page.evaluate(() => sessionStorage.setItem('oss-hub-logged-out', '/'));
  await page.reload();

  await expect(page.getByRole('heading', { name: HERO_HEADING })).toBeVisible();
  await expect(hero(page).getByRole('link')).toHaveCount(0);
  await expect(hero(page).getByRole('status')).toHaveCount(0);
  await expect(page.getByText('로그아웃되었습니다')).toHaveCount(0);
  const navSignIn = page
    .locator('[data-slot="nav-bar"]')
    .getByRole('link', { name: 'GitHub으로 로그인', exact: true });
  await expect(navSignIn).toHaveText('로그인');
  await expect(navSignIn).toHaveAttribute(
    'href',
    '/api/v1/auth/github?prompt=select_account',
  );
  audit.assertClean();
});

test('forged logout and purge query flags have no effect', async ({ page }) => {
  await page.goto('/?loggedOut=1');
  await expect(hero(page).getByRole('link')).toHaveCount(2);
  await expect(
    page.getByRole('link', { name: 'GitHub으로 로그인', exact: true }),
  ).toHaveAttribute('href', '/api/v1/auth/github');
  await page.goto('/programs?purged=forged-text');
  await expect(page.getByText('forged-text')).toHaveCount(0);
  await expect(
    page.getByRole('alert').filter({ hasText: '프로그램 전체 삭제' }),
  ).toHaveCount(0);
});
