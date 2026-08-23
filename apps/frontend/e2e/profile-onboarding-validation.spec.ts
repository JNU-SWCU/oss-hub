import { expect, test, type Page } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import { captureF3Evidence } from './support/f3-evidence';
import { installOnboardingFixture } from './support/member-access-fixture';

/**
 * 프로필 입력의 **거절 경로** — 잘못된 값이 저장으로 넘어가지 않는가.
 *
 * 성공 경로는 `auth-member-access.spec.ts`가 이미 지킨다. 여기서 보는 것은 그
 * 반대편이다: 화면이 오류를 띄우면서도 요청은 조용히 보내 버리면, 백엔드가 막아 주는
 * 동안에는 아무도 눈치채지 못하고 규칙이 한쪽에서 풀리는 순간 잘못된 값이 저장된다.
 * 그래서 시나리오마다 오류 표시 하나와 **프로필 POST 0건**을 함께 단언한다.
 *
 * 역할 선택 단계는 건너뛴다. 검증 대상은 프로필 폼이고, 앞 단계를 매번 다시 걷으면
 * 그 단계의 고장이 이 스펙의 실패로 보고돼 원인을 가린다. `installOnboardingFixture`
 * 뒤에 GET 전용 override를 얹어 "학생을 이미 고른 사람"으로 시작한다 — Playwright는
 * 나중에 등록한 라우트를 먼저 보므로 POST는 원래 픽스처가 계속 처리한다.
 */
async function installPreselectedStudent(page: Page): Promise<void> {
  await installOnboardingFixture(page);
  await page.route('**/api/v1/onboarding/role', async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ selectedRole: 'STUDENT' }),
    });
  });
}

/** 화면이 실제로 보낸 프로필 저장 요청 수를 센다. */
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
