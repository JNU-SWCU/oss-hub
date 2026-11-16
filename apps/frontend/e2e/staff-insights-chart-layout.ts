import { expect, type Page } from '@playwright/test';

export async function hideNextDevTools(page: Page): Promise<void> {
  const trigger = page.locator('[data-nextjs-dev-tools-button]');
  if (!(await trigger.isVisible())) return;
  await trigger.click();
  await page.locator('[data-preferences]').click();
  await page.locator('[data-hide-dev-tools]').click();
  await expect(trigger).toBeHidden();
}
