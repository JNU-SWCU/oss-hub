import { expect, test, type Route } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import {
  F3_SAVED_PROFILE,
  installSettingsSaveFailureFixture,
  type F3ApiHandlers,
} from './support/f3-account-fixture';
import { captureF3Evidence } from './support/f3-evidence';

const EDITED_NAME = '합성 수정한 이름';

const SETTINGS_SHELL_READS: F3ApiHandlers = {
  'GET /api/v1/team-invitations/received': (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
};

test('failed profile save keeps the edited value on the settings page', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const fixture = await installSettingsSaveFailureFixture(
    page,
    SETTINGS_SHELL_READS,
  );

  await page.goto('/settings');
  const nameInput = page.locator('#settings-name');
  await expect(nameInput).toHaveValue(F3_SAVED_PROFILE.name);

  await nameInput.fill(EDITED_NAME);
  await page.getByRole('button', { name: '저장' }).click();

  const failureAlert = page
    .locator('[data-slot="alert"]')
    .filter({ hasText: '저장 결과를 확인해 주세요' });
  await expect(failureAlert).toBeVisible();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(nameInput).toHaveValue(EDITED_NAME);
  await expect(page.getByText('저장되었습니다.')).toHaveCount(0);
  expect(fixture.profileWrites()).toBe(1);
  expect(fixture.notificationWrites()).toBe(0);

  await failureAlert.scrollIntoViewIfNeeded();
  await captureF3Evidence(page, testInfo, 'settings-profile-save-failure');

  audit.assertClean([
    { status: 500, path: '/api/v1/users/me/profile', method: 'PATCH' },
  ]);
});
