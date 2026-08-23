import { expect, test } from '@playwright/test';
import { installBrowserAudit } from './support/browser-audit';
import { installSyntheticAuthority } from './support/member-access-fixture';
import { captureResponsiveMenu } from './support/member-access-visual';

test('미해결 호환 관리자도 변경 요청 없이 정상 인증 셸을 사용한다', async ({
  page,
}, testInfo) => {
  // Given
  const audit = installBrowserAudit(page);
  const postRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      postRequests.push(new URL(request.url()).pathname);
    }
  });
  await installSyntheticAuthority(page, {
    role: 'ADMIN',
    memberKind: null,
    hasStaffAccess: true,
    hasAdminAccess: true,
  });
  await page.route('**/api/v1/dashboard/staff/summary', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ programs: [] }),
    }),
  );

  // When
  await page.goto('/dashboard');

  // Then
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator('[data-slot="nav-bar"]')).toBeVisible();
  await expect(page.locator('[data-slot="app-sidebar"]')).toBeVisible();
  await expect(
    page.locator('[role="group"][aria-label="교직원"]'),
  ).toBeVisible();
  await expect(
    page.locator('[role="group"][aria-label="관리자"]'),
  ).toBeVisible();
  await captureResponsiveMenu(
    page,
    testInfo,
    'menu-unresolved-compatibility-admin',
  );
  expect(postRequests).toEqual([]);
  audit.assertClean();
});
