import { expect, test, type Page } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';

const HERO_HEADING = '흩어진 정보를 하나로';
const ACCOUNT_SWITCH = '다른 계정으로 로그인';

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
  await expect(page.getByRole('link', { name: ACCOUNT_SWITCH })).toHaveCount(0);

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

test('logout notice adds the account switch link beside the hero action', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);

  await page.goto('/?loggedOut=1');

  await expect(hero(page).getByRole('status')).toContainText(
    '로그아웃되었습니다.',
  );
  const accountSwitch = hero(page).getByRole('link', { name: ACCOUNT_SWITCH });
  await expect(accountSwitch).toBeVisible();
  await expect(accountSwitch).toHaveAttribute(
    'href',
    '/api/v1/auth/github?prompt=select_account',
  );
  await expect(accountSwitch).toHaveAttribute('id', 'landing-account-switch');
  await expect(
    hero(page).getByRole('link', { name: '계정 전환 도움말' }),
  ).toHaveAttribute('href', '#landing-account-switch');
  audit.assertClean();
});
