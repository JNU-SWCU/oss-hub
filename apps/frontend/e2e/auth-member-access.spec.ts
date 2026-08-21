import type { Browser, Page, TestInfo } from '@playwright/test';

import { expect, test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';
import { attachStateScreenshot } from './support/admin-access-actions';
import { seedId } from './support/session-cookie';
import {
  installOnboardingFixture,
  installSyntheticAuthority,
  installUnassignedFixture,
  type SyntheticAuthority,
} from './support/member-access-fixture';

async function chooseMemberKind(page: Page, kind: 'STUDENT' | 'STAFF') {
  const radio = page.getByRole('radio', {
    name: kind === 'STUDENT' ? '학생' : '교직원',
  });
  await page.locator(`label[data-role="${kind}"]`).click();
  await expect(radio).toBeChecked();
  await page.getByRole('button', { name: '선택 완료' }).click();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
}

async function completeStaffProfile(page: Page) {
  await page.getByLabel('이름').fill('합성 교직원 회원');
  await page.getByLabel('소속 유형').selectOption('PROGRAM_OFFICE');
  await page
    .getByLabel('사업단', { exact: false })
    .fill('합성 SW중심대학사업단');
  await expect(page.getByLabel('학번')).toHaveCount(0);
  await page.getByRole('button', { name: '가입 마치기' }).click();
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  await attachStateScreenshot(page, testInfo, name);
}

test('student onboarding completes with affiliation and conditional student ID', async ({
  page,
}, testInfo) => {
  const fixture = await installOnboardingFixture(page);
  await page.goto('/onboarding/role');
  await chooseMemberKind(page, 'STUDENT');
  await page.getByLabel('이름').fill('합성 학생 회원');
  await page.getByLabel('학번').fill('260901');
  await page.locator('#profile-department').selectOption('인공지능학부');
  await capture(page, testInfo, 'student-onboarding-affiliation');
  await page.getByRole('button', { name: '가입 마치기' }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  expect(fixture.selectedKind()).toBe('STUDENT');
  await expect(
    page.getByRole('heading', { name: '내 대시보드', exact: true }),
  ).toBeVisible();
});

test('staff onboarding omits student ID and reaches pending approval', async ({
  page,
}, testInfo) => {
  const fixture = await installOnboardingFixture(page);
  await page.goto('/onboarding/role');
  await chooseMemberKind(page, 'STAFF');
  await completeStaffProfile(page);

  await expect(page).toHaveURL(/\/onboarding\/pending$/);
  expect(fixture.selectedKind()).toBe('STAFF');
  await expect(
    page.getByRole('heading', { name: '교직원 승인을 기다리고 있습니다' }),
  ).toBeVisible();
  await capture(page, testInfo, 'staff-onboarding-pending');
});

type MenuCase = {
  readonly name: string;
  readonly path: string;
  readonly authority: SyntheticAuthority;
  readonly visible: readonly string[];
  readonly hidden: readonly string[];
};

const UNIONED_MENU_CASES: readonly MenuCase[] = [
  {
    name: 'student',
    path: '/dashboard/activity',
    authority: {
      role: 'STUDENT',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
    visible: ['내 대시보드', '내 저장소', '내 활동'],
    hidden: ['운영 대시보드', '사용자 목록'],
  },
  {
    name: 'staff approved',
    path: '/dashboard/insights',
    authority: {
      role: 'STAFF',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: false,
    },
    visible: ['운영 대시보드', '학생 활성', '가입 신청'],
    hidden: ['내 활동', '사용자 목록'],
  },
  {
    name: 'student-admin',
    path: '/dashboard/activity',
    authority: {
      role: 'STUDENT',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: true,
    },
    visible: ['내 활동', '사용자 목록', '감사 로그', '시스템 상태'],
    hidden: ['운영 대시보드'],
  },
  {
    name: 'staff-admin',
    path: '/dashboard/insights',
    authority: {
      role: 'ADMIN',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: true,
    },
    visible: ['운영 대시보드', '가입 신청', '사용자 목록', '감사 로그'],
    hidden: ['내 활동'],
  },
];

async function assertMenuCase(browser: Browser, scenario: MenuCase) {
  const context = await browser.newContext();
  const page = await context.newPage();
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
  } finally {
    await context.close();
  }
}

test('unioned menus cover student, staff, student-admin, staff-admin, and admin-only', async ({
  browser,
  page,
  adminPage,
}, testInfo) => {
  for (const scenario of UNIONED_MENU_CASES) {
    await assertMenuCase(browser, scenario);
  }

  await installSyntheticAuthority(page, {
    role: 'ADMIN',
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: true,
  });
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/admin\/access$/);
  await capture(page, testInfo, 'admin-only-compatibility');

  await adminPage.goto(
    `/admin/access/users/${encodeURIComponent(seedId('auth', 'staff-revocable'))}`,
  );
  await expect(
    adminPage.locator('#admin-staff-access-control-label'),
  ).toHaveText('교직원 접근');
  await expect(
    adminPage.locator('#admin-admin-access-control-label'),
  ).toHaveText('관리자 접근');
  await capture(adminPage, testInfo, 'independent-admin-controls');
});

test('direct URL denial removes admin surfaces and backend denies staff', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('staff-revocable');
  await page.goto('/admin/access');
  await expect(page.getByText('접근 권한이 없는 페이지 입니다')).toBeVisible();
  await expect(page.getByText('사용자 목록', { exact: true })).toHaveCount(0);

  const response = await page.request.get(
    `${e2eEnvironment.baseUrl}/api/v1/users/access`,
  );
  expect(response.status()).toBe(403);
  await capture(page, testInfo, 'direct-url-denied');
});

test('rejected staff returns to member selection with the rejection reason', async ({
  authSeedPage,
}) => {
  const page = await authSeedPage('staff-rejected');
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/onboarding\/role$/);
  await expect(page.getByText('교직원 요청이 반려되었습니다')).toBeVisible();
  await expect(page.getByText(/담당 프로그램 소속 확인 불가/)).toBeVisible();
});

test('revoked staff is unassigned and has no staff surface', async ({
  page,
}) => {
  await installUnassignedFixture(page, 'REVOKED');
  await page.goto('/dashboard/insights');
  await expect(page).toHaveURL(/\/onboarding\/role$/);
  await expect(page.getByText('운영 대시보드', { exact: true })).toHaveCount(0);
  await expect(page.getByText('사용자 목록', { exact: true })).toHaveCount(0);
});

test('deactivated session is denied by the backend and shown as logged out', async ({
  authSeedPage,
}) => {
  const page = await authSeedPage('staff-revoked');
  await page.goto('/dashboard');
  await expect(page.getByText(/로그인이 필요/)).toBeVisible();
  const session = await page.request.get(
    `${e2eEnvironment.baseUrl}/api/v1/auth/session`,
  );
  expect(session.status()).toBe(200);
  expect(await session.json()).toEqual({ isAuthenticated: false });
  const denied = await page.request.get(
    `${e2eEnvironment.baseUrl}/api/v1/users/access`,
  );
  expect(denied.status()).toBe(401);
});
