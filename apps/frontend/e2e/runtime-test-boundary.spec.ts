import { writeFile } from 'node:fs/promises';
import type { Page, TestInfo } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';
import { installBrowserAudit } from './support/browser-audit';

const RETIRED_COOKIE = 'oss_hub_local_review_fixture';
const FIXTURE_HEADER = 'x-oss-hub-local-fixture';

async function addRetiredCookie(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: RETIRED_COOKIE, value: 'admin', url: e2eEnvironment.baseUrl },
    ]);
}

async function readRealSession(page: Page): Promise<unknown> {
  const [proxied, direct] = await Promise.all([
    page.request.get('/api/v1/auth/session'),
    page.request.get(
      `http://127.0.0.1:${e2eEnvironment.backendPort}/api/v1/auth/session`,
    ),
  ]);
  expect(proxied.status()).toBe(200);
  expect(direct.status()).toBe(200);
  expect(proxied.headers()).not.toHaveProperty(FIXTURE_HEADER);
  expect(direct.headers()).not.toHaveProperty(FIXTURE_HEADER);
  const session: unknown = await proxied.json();
  expect(session).toEqual(await direct.json());
  return session;
}

async function attachOverview(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  const imagePath = testInfo.outputPath(`${name}.png`);
  const conditionsPath = testInfo.outputPath(`${name}-conditions.json`);
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  expect(viewport).toEqual(page.viewportSize());
  const image = await page.screenshot({ path: imagePath });
  expect(new Set(image).size).toBeGreaterThan(32);
  await testInfo.attach(name, {
    path: imagePath,
    contentType: 'image/png',
  });
  await writeFile(
    conditionsPath,
    JSON.stringify({
      schemaVersion: 1,
      kind: 'browser-automation-transcript',
      tool: 'Playwright Chrome',
      url: page.url(),
      viewport,
      tree: await page.locator('main').ariaSnapshot(),
      state: 'anonymous; real isolated auth seed; retired cookie ignored',
      screenshot: `${name}.png`,
      commands: [
        `page.screenshot({ path: testInfo.outputPath('${name}.png') })`,
      ],
    }),
  );
  await testInfo.attach(`${name}-conditions`, {
    path: conditionsPath,
    contentType: 'application/json',
  });
}

test('retired activation and API routes are absent', async ({ page }) => {
  for (const route of [
    '/local-review/admin?to=/dashboard',
    '/local-review-api/auth/session',
  ]) {
    const response = await page.request.get(route, { maxRedirects: 0 });
    expect(response.status(), route).toBe(404);
    expect(response.headers()).not.toHaveProperty(FIXTURE_HEADER);
  }
});

test('retired persona cookie cannot replace anonymous backend traffic or navigation', async ({
  page,
}, testInfo) => {
  await addRetiredCookie(page);
  expect(await readRealSession(page)).toEqual({ isAuthenticated: false });

  const audit = installBrowserAudit(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: '흩어진 정보를 한 곳으로' }),
  ).toBeVisible();
  await attachOverview(page, testInfo, 'runtime-boundary-desktop-overview');
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole('heading', { name: '흩어진 정보를 한 곳으로' }),
  ).toBeVisible();
  await attachOverview(page, testInfo, 'runtime-boundary-mobile-overview');

  await page.setViewportSize({ width: 1440, height: 900 });
  // Keep this routing smoke independent of covers left by authoring mutations.
  const rankingResponses = Promise.all(
    ['/api/v1/ranking', '/api/v1/ranking/years'].map((pathname) =>
      page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === pathname &&
          response.request().method() === 'GET',
      ),
    ),
  );
  await page
    .getByRole('navigation')
    .getByRole('link', { name: '랭킹', exact: true })
    .click();
  await expect(page).toHaveURL(/\/ranking$/);
  await expect(
    page.getByRole('heading', { name: '랭킹', exact: true }),
  ).toBeVisible();
  for (const response of await rankingResponses) {
    expect(response.status()).toBe(200);
    expect(response.headers()).not.toHaveProperty(FIXTURE_HEADER);
  }
  await expect(page.getByText('랭킹을 불러오는 중입니다…')).toHaveCount(0);
  await expect(page.getByText('랭킹을 불러오지 못했습니다.')).toHaveCount(0);
  expect(await readRealSession(page)).toEqual({ isAuthenticated: false });
  audit.assertClean();
});

test('retired admin persona cannot replace the real student session', async ({
  authSeedPage,
}) => {
  const page = await authSeedPage('student-confirmed');
  await addRetiredCookie(page);

  expect(await readRealSession(page)).toMatchObject({
    isAuthenticated: true,
    user: {
      nickname: 'seed-auth-student-confirmed',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
    },
  });
});
