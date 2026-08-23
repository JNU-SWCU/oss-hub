import type { Browser, Page, TestInfo } from '@playwright/test';

import { expect, test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';
import { installBrowserAudit } from './support/browser-audit';
import {
  installOnboardingFixture,
  installSyntheticAuthority,
  installUnassignedFixture,
} from './support/member-access-fixture';
import {
  assertTabSequence,
  captureResponsiveMenu,
  captureResponsivePage,
} from './support/member-access-visual';
import {
  UNIONED_MENU_CASES,
  type MenuCase,
} from './support/member-access-menu-cases';
import { seedId } from './support/session-cookie';

async function chooseMemberKind(
  page: Page,
  kind: 'STUDENT' | 'STAFF',
): Promise<void> {
  const radio = page.getByRole('radio', {
    name: kind === 'STUDENT' ? '학생' : '교직원',
  });
  await page.locator(`label[data-role="${kind}"]`).click();
  await expect(radio).toBeChecked();
  await page.getByRole('button', { name: '선택 완료' }).click();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
}

async function captureMenuCase(
  browser: Browser,
  scenario: MenuCase,
  testInfo: TestInfo,
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const audit = installBrowserAudit(page);
  try {
    await installSyntheticAuthority(page, scenario.authority);
    await page.goto(scenario.path);
    for (const label of scenario.visible) {
      await expect(
        page.getByText(label, { exact: true }).first(),
      ).toBeVisible();
    }
    for (const label of scenario.hidden) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    await captureResponsiveMenu(page, testInfo, `menu-${scenario.name}`);
    audit.assertClean();
  } finally {
    await context.close();
  }
}

test('student onboarding completes with affiliation and conditional student ID', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const fixture = await installOnboardingFixture(page);
  await page.goto('/onboarding/role');
  await assertTabSequence(
    page,
    page.getByRole('radio', { name: '학생' }),
    page.getByRole('radio', { name: '교직원' }),
    'ArrowRight',
  );
  await captureResponsivePage(page, testInfo, 'student-member-selection');
  await chooseMemberKind(page, 'STUDENT');
  await page.getByLabel('이름').fill('합성 학생 회원');
  await page.getByLabel('학번').fill('260901');
  await page.locator('#profile-department').selectOption('인공지능학부');
  await assertTabSequence(
    page,
    page.getByLabel('이름'),
    page.getByLabel('학번'),
  );
  await captureResponsivePage(page, testInfo, 'student-onboarding-affiliation');
  await page.getByRole('button', { name: '가입 마치기' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(fixture.selectedKind()).toBe('STUDENT');
  await expect(
    page.getByRole('heading', { name: '내 대시보드' }),
  ).toBeVisible();
  audit.assertClean();
});

test('staff onboarding omits student ID and reaches pending approval', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const fixture = await installOnboardingFixture(page);
  await page.goto('/onboarding/role');
  await captureResponsivePage(page, testInfo, 'staff-member-selection');
  await chooseMemberKind(page, 'STAFF');
  await page.getByLabel('이름').fill('합성 교직원 회원');
  await page.getByLabel('소속 유형').selectOption('PROGRAM_OFFICE');
  await page
    .getByLabel('사업단', { exact: false })
    .fill('합성 SW중심대학사업단');
  await expect(page.getByLabel('학번')).toHaveCount(0);
  await captureResponsivePage(page, testInfo, 'staff-onboarding-affiliation');
  await page.getByRole('button', { name: '가입 마치기' }).click();
  await expect(page).toHaveURL(/\/onboarding\/pending$/);
  expect(fixture.selectedKind()).toBe('STAFF');
  await expect(
    page.getByRole('heading', { name: /교직원 승인을/ }),
  ).toBeVisible();
  await captureResponsivePage(page, testInfo, 'staff-onboarding-pending');
  audit.assertClean();
});

test('unioned menus cover student, staff, student-admin, staff-admin, and admin-only', async ({
  browser,
  page,
  adminPage,
}, testInfo) => {
  for (const scenario of UNIONED_MENU_CASES) {
    await captureMenuCase(browser, scenario, testInfo);
  }

  const adminOnlyAudit = installBrowserAudit(page);
  const adminOnlyPostRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      adminOnlyPostRequests.push(new URL(request.url()).pathname);
    }
  });
  await installSyntheticAuthority(page, {
    role: 'ADMIN',
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: true,
  });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/admin\/access$/);
  await expect(page.locator('[data-slot="nav-bar"]')).toBeVisible();
  await captureResponsiveMenu(page, testInfo, 'menu-admin-only');
  expect(adminOnlyPostRequests).toEqual([]);
  adminOnlyAudit.assertClean();

  const adminAudit = installBrowserAudit(adminPage);
  await adminPage.goto(
    `/admin/access/users/${encodeURIComponent(seedId('auth', 'admin-second'))}`,
  );
  await expect(
    adminPage.locator('#admin-staff-access-control-label'),
  ).toHaveText('교직원 접근');
  await expect(
    adminPage.locator('#admin-admin-access-control-label'),
  ).toHaveText('관리자 접근');
  await captureResponsivePage(adminPage, testInfo, 'admin-only-controls');
  await adminPage.goto(
    `/admin/access/users/${encodeURIComponent(seedId('auth', 'staff-revocable'))}`,
  );
  await expect(
    adminPage.locator('#admin-staff-access-control-label'),
  ).toHaveText('교직원 접근');
  await expect(
    adminPage.locator('#admin-admin-access-control-label'),
  ).toHaveText('관리자 접근');
  const deactivate = adminPage.getByRole('radio', { name: '비활성' });
  await deactivate.focus();
  await expect(deactivate).toBeFocused();
  await captureResponsivePage(adminPage, testInfo, 'staff-only-controls');
  adminAudit.assertClean();
});

test('direct URL denial removes admin surfaces and backend denies staff', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('staff-revocable');
  const audit = installBrowserAudit(page);
  await page.goto('/admin/access');
  await expect(page.getByText('접근 권한이 없는 페이지 입니다')).toBeVisible();
  await expect(page.getByText('사용자 목록', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '내 화면으로 돌아가기' }).focus();
  await expect(
    page.getByRole('link', { name: '내 화면으로 돌아가기' }),
  ).toBeFocused();
  await captureResponsivePage(page, testInfo, 'direct-url-denied');
  const response = await page.request.get(
    `${e2eEnvironment.baseUrl}/api/v1/users/access`,
  );
  expect(response.status()).toBe(403);
  audit.assertClean();
});

test('rejected staff returns to member selection with the rejection reason', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('staff-rejected');
  const audit = installBrowserAudit(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/onboarding\/role$/);
  await expect(page.getByText('교직원 요청이 반려되었습니다')).toBeVisible();
  await captureResponsivePage(page, testInfo, 'staff-rejected');
  audit.assertClean();
});

test('revoked staff is unassigned and has no staff surface', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  await installUnassignedFixture(page, 'NONE');
  await page.goto('/dashboard/insights');
  await expect(page).toHaveURL(/\/onboarding\/role$/);
  await captureResponsivePage(page, testInfo, 'member-unassigned');
  audit.assertClean();

  const revokedPage = await page.context().newPage();
  const revokedAudit = installBrowserAudit(revokedPage);
  await installUnassignedFixture(revokedPage, 'REVOKED');
  await revokedPage.goto('/dashboard/insights');
  await expect(revokedPage).toHaveURL(/\/onboarding\/role$/);
  await expect(
    revokedPage.getByText('운영 대시보드', { exact: true }),
  ).toHaveCount(0);
  await captureResponsivePage(revokedPage, testInfo, 'staff-revoked');
  revokedAudit.assertClean();
  await revokedPage.close();
});

test('deactivated session is denied by the backend and shown as logged out', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('staff-revoked');
  const audit = installBrowserAudit(page);
  await page.goto('/dashboard');
  await expect(page.getByText(/로그인이 필요/)).toBeVisible();
  await captureResponsivePage(page, testInfo, 'deactivated-session');
  const session = await page.request.get(
    `${e2eEnvironment.baseUrl}/api/v1/auth/session`,
  );
  expect(await session.json()).toEqual({ isAuthenticated: false });
  const denied = await page.request.get(
    `${e2eEnvironment.baseUrl}/api/v1/users/access`,
  );
  expect(denied.status()).toBe(401);
  audit.assertClean();
});
