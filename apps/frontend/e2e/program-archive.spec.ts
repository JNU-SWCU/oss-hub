import { expect, test, type Page } from '@playwright/test';
import { installBrowserAudit } from './support/browser-audit';

const ended = [2026, 2025].map((year) => ({
  id: `archive-ended-${year}`,
  name: `${year} 합성 오픈소스 프로그램`,
  organizer: '합성 운영처',
  trackType: 'EXTRACURRICULAR',
  lifecycle: 'PUBLISHED',
  applicationStartAt: `${year}-01-01T00:00:00.000Z`,
  applicationEndAt: `${year}-02-01T00:00:00.000Z`,
  endAt: `${year}-06-30T00:00:00.000Z`,
  description: '종료 프로그램 아카이브 검증',
  coverImageUrl: null,
}));
const current = {
  ...ended[0],
  id: 'archive-current',
  name: '합성 모집 프로그램',
  applicationEndAt: '2026-12-01T00:00:00.000Z',
  endAt: '2027-06-30T00:00:00.000Z',
};
const project = {
  projectId: 'archive-project',
  programId: ended[0].id,
  programName: ended[0].name,
  trackType: 'EXTRACURRICULAR',
  applicationMode: 'TEAM',
  displayName: '합성 공개 프로젝트',
  repositoryName: 'archive-project',
  githubUrl: 'https://github.com/JNU-SWCU/archive-project',
  publishedAt: '2026-07-01T00:00:00.000Z',
  metrics: { commitCount: 3, pullRequestCount: 1, releaseCount: 0 },
  contributors: [],
};

async function mockArchive(page: Page, staff = false) {
  await page.clock.setFixedTime(new Date('2026-10-27T00:00:00.000Z'));
  await page.route('**/api/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/v1/auth/session') {
      await route.fulfill({
        json: staff
          ? {
              isAuthenticated: true,
              user: {
                nickname: 'archive-staff',
                name: null,
                email: null,
                avatarUrl: null,
                memberKind: 'STAFF',
                hasStaffAccess: true,
                hasAdminAccess: false,
                isProfileComplete: true,
              },
            }
          : { isAuthenticated: false },
      });
    } else if (path === '/api/v1/programs/ended-years') {
      await route.fulfill({ json: { years: [2026, 2025] } });
    } else if (path === '/api/v1/programs/status-counts') {
      await route.fulfill({
        json: { all: 3, recruiting: 1, in_progress: 0, upcoming: 0, ended: 2 },
      });
    } else if (path === '/api/v1/programs') {
      const status = url.searchParams.get('status');
      expect(['ended', 'current']).toContain(status);
      const year = url.searchParams.get('year');
      const items =
        status === 'current'
          ? [current]
          : ended.filter(
              (program) =>
                year === null || program.id === `archive-ended-${year}`,
            );
      await route.fulfill({
        json: {
          items,
          page: 1,
          pageSize: 20,
          totalItems: items.length,
          totalPages: items.length ? 1 : 0,
        },
      });
    } else if (path === `/api/v1/projects/${project.projectId}`) {
      await route.fulfill({ json: project });
    } else {
      const program = ended.find(
        (item) =>
          path === `/api/v1/programs/${item.id}` ||
          path === `/api/v1/programs/${item.id}/viewer`,
      );
      if (!program) throw new Error(`Unexpected archive request: ${path}`);
      await route.fulfill({
        json: {
          id: program.id,
          name: program.name,
          organizer: program.organizer,
          trackType: program.trackType,
          lifecycle: program.lifecycle,
          description: program.description,
          repositoryProvisioningEnabled: false,
          applicationTemplateKey: 'basic',
          applicationPeriod: {
            startsAt: program.applicationStartAt,
            endsAt: program.applicationEndAt,
          },
          operatingPeriod: {
            startsAt: program.applicationStartAt,
            endsAt: program.endAt,
          },
          viewer: { role: null, applicationStatus: null },
          milestones: [],
        },
      });
    }
  });
}

for (const width of [1440, 390]) {
  test(`종료 프로그램과 연도 필터에서 동일한 프로그램 상세를 연다 (${width})`, async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    await mockArchive(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/archive');
    const cards = page.locator('[data-slot="program-card"]');
    await expect(cards).toHaveCount(2);
    await expect(cards.first()).toHaveAttribute('data-status', 'ended');
    await page.evaluate(() => document.fonts.ready);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - innerWidth,
      ),
    ).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath(`archive-${width}.png`),
      style: 'nextjs-portal { visibility: hidden; }',
    });
    const response = page.waitForResponse((result) => {
      const url = new URL(result.url());
      return (
        url.pathname === '/api/v1/programs' &&
        url.searchParams.get('status') === 'ended' &&
        url.searchParams.get('year') === '2025'
      );
    });
    if (width === 390) {
      await page
        .locator('[data-slot="archive-list-year-chips"]')
        .getByRole('button', { name: '2025', exact: true })
        .click();
    } else {
      await page
        .getByRole('navigation', { name: '공개 아카이브', exact: true })
        .getByRole('link', { name: '2025', exact: true })
        .click();
    }
    expect((await response).status()).toBe(200);
    await expect(page).toHaveURL('/archive?year=2025');
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toContainText(ended[1].name);
    await page.screenshot({
      path: testInfo.outputPath(`archive-year-2025-${width}.png`),
      style: 'nextjs-portal { visibility: hidden; }',
    });
    await cards.first().click();
    await expect(page).toHaveURL(`/programs/${ended[1].id}`);
    await expect(
      page.getByRole('heading', { name: ended[1].name }),
    ).toBeVisible();
    audit.assertClean();
  });

  test(`프로그램 기본 목록은 미종료만 요청하고 종료 필터가 없다 (${width})`, async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    await mockArchive(page);
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    await page.goto('/programs');
    await expect(page.locator('[data-slot="program-card"]')).toHaveCount(1);
    await expect(page.locator('[data-slot="program-card"]')).toContainText(
      current.name,
    );
    await expect(
      page.getByRole('button', { name: '종료', exact: true }),
    ).toHaveCount(0);
    await expect(page.locator('a[href="/programs?status=ended"]')).toHaveCount(
      0,
    );
    if (width === 1440) {
      await expect(
        page
          .getByRole('navigation', { name: '프로그램 메뉴', exact: true })
          .getByRole('link', { name: '전체', exact: false }),
      ).toContainText('1');
    }
    await page.screenshot({
      path: testInfo.outputPath(`programs-current-${width}.png`),
      style: 'nextjs-portal { visibility: hidden; }',
    });
    audit.assertClean();
  });
}

test('교직원도 같은 종료 프로그램 아카이브를 본다', async ({ page }) => {
  await mockArchive(page, true);
  await page.goto('/archive?year=2025');
  await expect(page.locator('[data-slot="program-card"]')).toHaveCount(1);
  await expect(
    page.locator('a[href="/programs/archive-ended-2025"]'),
  ).toBeVisible();
  await expect(page.locator('a[href="/programs/new"]')).toHaveCount(0);
});

test('옛 종료 필터 및 공개 프로젝트 상세 URL을 새 경로로 이동한다', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  await mockArchive(page);
  await page.goto('/programs?status=ended');
  await expect(page).toHaveURL('/archive');
  await expect(page.locator('[data-slot="program-card"]')).toHaveCount(2);
  const response = await page.goto(`/archive/${project.projectId}`);
  const redirected = await response?.request().redirectedFrom()?.response();
  expect(redirected?.status()).toBe(308);
  await expect(page).toHaveURL(`/projects/${project.projectId}`);
  await expect(
    page.getByRole('heading', { name: project.displayName, exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-slot="app-sidebar"]')).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('project-redirect.png'),
    style: 'nextjs-portal { visibility: hidden; }',
  });
  audit.assertClean();
});
