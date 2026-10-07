import { expect, test, type Page, type Route } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import { captureF3Evidence } from './support/f3-evidence';
import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';

const INCOMPLETE_PROFILE = {
  name: 'GitHub 합성 이름',
  studentId: null,
  staffNumber: null,
  department: null,
  phone: null,
  isComplete: false,
} as const;

function jsonHandler(body: unknown) {
  return async (route: Route): Promise<void> => {
    await fulfillJson(route, body);
  };
}

async function installPreselectedStudent(page: Page): Promise<void> {
  await installSyntheticAuthority(
    page,
    {
      role: null,
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
      isProfileComplete: false,
    },
    {
      'GET /api/v1/onboarding/role': jsonHandler({ selectedRole: 'STUDENT' }),
      'GET /api/v1/role-requests/me': jsonHandler(null),
      'GET /api/v1/users/me/profile': jsonHandler(INCOMPLETE_PROFILE),
    },
  );
}

function countProfilePosts(page: Page): () => number {
  let posts = 0;
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      new URL(request.url()).pathname.endsWith('/users/me/profile')
    ) {
      posts += 1;
    }
  });
  return () => posts;
}

test('empty name blocks profile submission with a field error', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const profilePosts = countProfilePosts(page);
  await installPreselectedStudent(page);

  await page.goto('/onboarding/profile');
  await page.getByLabel('이름').fill('');
  await page.getByLabel('학번').fill('260901');
  await page.locator('#profile-department').selectOption('인공지능학부');
  await page.getByRole('button', { name: '가입 마치기' }).click();

  await expect(page.locator('#profile-name-error')).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  expect(profilePosts()).toBe(0);

  await captureF3Evidence(page, testInfo, 'profile-invalid-name');
  audit.assertClean();
});

test('malformed student id blocks profile submission with a field error', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const profilePosts = countProfilePosts(page);
  await installPreselectedStudent(page);

  await page.goto('/onboarding/profile');
  await page.getByLabel('이름').fill('합성 학생 회원');
  await page.getByLabel('학번').fill('12345');
  await page.locator('#profile-department').selectOption('인공지능학부');
  await page.getByRole('button', { name: '가입 마치기' }).click();

  await expect(page.locator('#profile-student-id-error')).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  expect(profilePosts()).toBe(0);

  await captureF3Evidence(page, testInfo, 'profile-invalid-student-id');
  audit.assertClean();
});

test('missing affiliation blocks profile submission with a field error', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  const profilePosts = countProfilePosts(page);
  await installPreselectedStudent(page);

  await page.goto('/onboarding/profile');
  await page.getByLabel('이름').fill('합성 학생 회원');
  await page.getByLabel('학번').fill('260901');
  await page.getByRole('button', { name: '가입 마치기' }).click();

  await expect(page.locator('#profile-department-error')).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  expect(profilePosts()).toBe(0);

  await captureF3Evidence(page, testInfo, 'profile-invalid-affiliation');
  audit.assertClean();
});
