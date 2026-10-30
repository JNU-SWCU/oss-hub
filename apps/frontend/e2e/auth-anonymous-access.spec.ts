import { expect, test } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import { captureF3Evidence } from './support/f3-evidence';

test('anonymous visitor gets the login notice in place on a protected route', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);

  await page.goto('/dashboard');

  const notice = page.locator('#login-required-heading');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText('로그인이 필요합니다');
  await expect(notice).not.toHaveAttribute('role', 'alert');
  await expect(
    page.locator('section[aria-labelledby="login-required-heading"]'),
  ).toBeVisible();
  const signIn = page
    .locator('section[aria-labelledby="login-required-heading"]')
    .getByRole('link', { name: 'GitHub으로 로그인', exact: true });
  await expect(signIn).toHaveText('로그인');
  await expect(signIn).toHaveAttribute('href', '/api/v1/auth/github');
  await expect(page).toHaveURL(/\/dashboard$/);

  await captureF3Evidence(page, testInfo, 'anonymous-protected-route');

  await page.route('**/api/v1/auth/github**', (route) =>
    route.abort('aborted'),
  );
  const oauthStart = page.waitForRequest('**/api/v1/auth/github');
  await signIn.click();
  await oauthStart;
  const stored = await page.evaluate(() =>
    sessionStorage.getItem('oss-hub-login-destination'),
  );
  expect(JSON.parse(stored ?? 'null')).toMatchObject({
    destination: '/dashboard',
  });
  audit.assertClean();
});
