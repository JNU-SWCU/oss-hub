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

for (const width of [1440, 390]) {
  test(`저장 중 입력 잠금과 부분 실패 보존 ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await installSettingsSaveFailureFixture(page, SETTINGS_SHELL_READS);
    const profile = Promise.withResolvers<void>();
    const notification = Promise.withResolvers<void>();
    let profileWrites = 0;
    let notificationWrites = 0;
    await page.route('**/api/v1/users/me/profile', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      profileWrites += 1;
      await profile.promise;
      await route.fulfill({ json: F3_SAVED_PROFILE });
    });
    await page.route('**/api/v1/users/me/notification-email', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      notificationWrites += 1;
      await notification.promise;
      await route.fulfill({
        status: 503,
        json: {
          type: 'about:blank',
          title: 'Unavailable',
          status: 503,
          detail: '합성 알림 저장 실패',
          code: 'TST_001',
          instance: '/api/v1/users/me/notification-email',
        },
      });
    });
    await page.goto('/settings');
    await page.locator('#settings-name').fill(EDITED_NAME);
    await page
      .locator('#settings-notification-email')
      .fill('edited@example.com');
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.locator('#settings-name')).toBeDisabled();
    await expect(page.locator('#settings-notification-email')).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath('profile-pending.png'),
      fullPage: true,
    });
    profile.resolve();
    await expect.poll(() => notificationWrites).toBe(1);
    await expect(page.locator('#settings-name')).toBeDisabled();
    await page.screenshot({
      path: testInfo.outputPath('notification-pending.png'),
      fullPage: true,
    });
    notification.resolve();
    await expect(page.getByText(/프로필은 저장했습니다/)).toBeVisible();
    await expect(page.locator('#settings-notification-email')).toHaveValue(
      'edited@example.com',
    );
    await expect(page.locator('#settings-name')).toBeEnabled();
    await expect(page.getByText('저장되었습니다.')).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath('partial-failure.png'),
      fullPage: true,
    });
    await page.route('**/api/v1/users/me/notification-email', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      await route.fulfill({
        json: { notificationEmail: 'edited@example.com', notifyEnabled: true },
      });
    });
    await page.getByRole('button', { name: '저장', exact: true }).click();
    await expect(page.getByText('저장되었습니다.')).toBeVisible();
    await page.locator('#settings-name').fill('합성 다시 수정');
    await expect(page.getByText('저장되었습니다.')).toHaveCount(0);
    expect(profileWrites).toBe(2);
    await page.screenshot({
      path: testInfo.outputPath('edited-after-success.png'),
      fullPage: true,
    });
  });
}
