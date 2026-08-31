import { expect, test, type Page } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';

const POLICY_PATH = '/policies/privacy/2026-08-11.html';
const POLICY_LINK_NAME = '개인정보 수집·이용';

async function expectPublicPolicy(page: Page) {
  await expect(page).toHaveURL(new RegExp(`${POLICY_PATH}$`));
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    POLICY_LINK_NAME,
  );
  await expect(
    page.getByRole('heading', { name: '수집 항목과 목적' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '보유와 삭제' }),
  ).toBeVisible();
}

test('anonymous visitor opens and reloads the public privacy policy with a pointer', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('/');
  const policyLink = page.getByRole('link', {
    name: POLICY_LINK_NAME,
    exact: true,
  });
  await policyLink.scrollIntoViewIfNeeded();
  await expect(policyLink).toHaveAttribute('href', POLICY_PATH);
  await page.screenshot({
    path: testInfo.outputPath('anonymous-footer-before.png'),
    fullPage: true,
  });

  await policyLink.click();
  await expectPublicPolicy(page);

  await page.reload();
  await expectPublicPolicy(page);
  audit.assertClean();
});

test('anonymous visitor opens the public privacy policy with the keyboard', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.goto('/');
  const policyLink = page.getByRole('link', {
    name: POLICY_LINK_NAME,
    exact: true,
  });
  await policyLink.scrollIntoViewIfNeeded();
  await policyLink.focus();
  await expect(policyLink).toBeFocused();

  await page.keyboard.press('Enter');
  await expectPublicPolicy(page);
  audit.assertClean();
});
