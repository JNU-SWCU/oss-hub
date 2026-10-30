import { expect, test, type Page } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';

const HERO_HEADING = '흩어진 정보를 하나로';

function hero(page: Page) {
  return page.locator('#landing-hero');
}

test('legacy signup link lands on the hero and keeps the return path', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);

  await page.goto('/signup?returnTo=%2Fprograms%2F42%2Fapply');

  await expect(page).toHaveURL(
    new URL('/?returnTo=%2Fprograms%2F42%2Fapply', page.url()).href,
  );
  await expect(page.getByRole('heading', { name: HERO_HEADING })).toBeVisible();
  const start = hero(page).getByRole('link', {
    name: 'GitHub으로 시작하기',
    exact: true,
  });
  await expect(start).toHaveText('시작하기');
  await expect(start).toHaveAttribute('href', '/api/v1/auth/github');
  await expect(hero(page).getByRole('link')).toHaveCount(2);

  await page.route('**/api/v1/auth/github**', (route) =>
    route.abort('aborted'),
  );
  const oauthStart = page.waitForRequest('**/api/v1/auth/github');
  await start.click();
  await oauthStart;
  const stored = await page.evaluate(() =>
    sessionStorage.getItem('oss-hub-login-destination'),
  );
  expect(JSON.parse(stored ?? 'null')).toMatchObject({
    destination: '/programs/42/apply',
  });
  audit.assertClean();
});

test('legacy signup link drops an unsafe return path', async ({ page }) => {
  const audit = installBrowserAudit(page);

  await page.goto('/signup?returnTo=%2F%2Fevil.example');

  await expect(page).toHaveURL(new URL('/', page.url()).href);
  await expect(page.getByRole('heading', { name: HERO_HEADING })).toBeVisible();
  audit.assertClean();
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
  await expect(page.getByRole('link', { name: 'GitHub으로 로그인', exact: true }))
    .toHaveAttribute('href', '/api/v1/auth/github');
  await page.goto('/programs?purged=forged-text');
  await expect(page.getByText('forged-text')).toHaveCount(0);
  await expect(page.getByRole('alert').filter({ hasText: '프로그램 전체 삭제' })).toHaveCount(0);
});
