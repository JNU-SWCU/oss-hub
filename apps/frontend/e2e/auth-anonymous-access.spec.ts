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
  await expect(
    page
      .locator('section[aria-labelledby="login-required-heading"]')
      .getByRole('link', { name: '로그인', exact: true }),
  ).toHaveAttribute('href', '/signup?returnTo=%2Fdashboard');
  await expect(page).toHaveURL(/\/dashboard$/);

  await captureF3Evidence(page, testInfo, 'anonymous-protected-route');
  audit.assertClean();
});
