import { expect, test, type Page } from '@playwright/test';
import {
  fulfillJson,
  installSyntheticAuthority,
} from './support/member-access-fixture';

const PROGRAM_ID = 'synthetic-url-state';
const TEAM_ID = 'synthetic-url-team';

async function installProgram(page: Page) {
  const program = {
    id: PROGRAM_ID,
    name: 'x 프로그램',
    organizer: '합성 운영처',
    trackType: 'EXTRACURRICULAR',
    lifecycle: 'PUBLISHED',
    applicationTemplateKey: 'basic',
    description: '합성 프로그램',
    repositoryProvisioningEnabled: false,
    applicationPeriod: {
      startsAt: '2026-01-01T00:00:00.000Z',
      endsAt: '2026-12-01T00:00:00.000Z',
    },
    viewer: { role: 'STAFF', applicationStatus: null },
    milestones: [],
  };
  await installSyntheticAuthority(
    page,
    {
      role: 'STAFF',
      memberKind: 'STAFF',
      hasStaffAccess: true,
      hasAdminAccess: false,
    },
    {
      'GET /api/v1/programs/status-counts': (route) =>
        fulfillJson(route, { all: 40, recruiting: 40 }),
      [`GET /api/v1/programs/${PROGRAM_ID}`]: (route) =>
        fulfillJson(route, program),
      [`GET /api/v1/programs/${PROGRAM_ID}/viewer`]: (route) =>
        fulfillJson(route, program),
      [`GET /api/v1/programs/${PROGRAM_ID}/overview`]: (route) =>
        fulfillJson(route, {
          programId: PROGRAM_ID,
          name: program.name,
          trackType: program.trackType,
          lifecycle: program.lifecycle,
          milestoneCount: 0,
          boardPostCount: 0,
          participantCount: 1,
          teamCount: 1,
          connectedRepositoryCount: 0,
          viewerRole: 'STAFF',
          viewerDocumentsCompleted: null,
          viewerDocumentsTotal: null,
          fullySubmittedParticipantCount: 0,
          remainingMilestones: [],
          milestoneDocuments: [],
        }),
      [`GET /api/v1/programs/${PROGRAM_ID}/activity`]: (route) =>
        fulfillJson(route, []),
      [`GET /api/v1/programs/${PROGRAM_ID}/teams/${TEAM_ID}`]: (route) =>
        fulfillJson(route, {
          teamId: TEAM_ID,
          name: 'x 팀',
          memberCount: 0,
          members: [],
          application: null,
          repositoryContributions: null,
          deletionScope: {
            applications: 0,
            members: 0,
            invitations: 0,
            submissions: 0,
            submissionEvents: 0,
            detachedRepositories: 0,
            scopeFingerprint: 'a'.repeat(32),
          },
        }),
      [`GET /api/v1/programs/${PROGRAM_ID}/teams/${TEAM_ID}/activity`]: (
        route,
      ) =>
        fulfillJson(route, {
          applicationId: null,
          repository: null,
          status: 'NOT_CONNECTED',
          lastSuccessAt: null,
          window: {
            from: '2026-01-01',
            to: '2026-12-31',
            timeZone: 'Asia/Seoul',
          },
          canEditRepositoryUrl: false,
          members: [],
        }),
      [`GET /api/v1/programs/${PROGRAM_ID}/teams/${TEAM_ID}/repository-url-history`]:
        (route) => fulfillJson(route, { items: [], nextCursor: null }),
      [`GET /api/v1/team-invitations/teams/${TEAM_ID}/sent`]: (route) =>
        fulfillJson(route, []),
    },
  );
}

test.beforeEach(async ({ page }) => {
  await installProgram(page);
});

async function mockPrograms(page: Page, programId: string) {
  const requests: URL[] = [];
  await page.route('**/api/v1/programs?*', async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    await route.fulfill({
      json: {
        items: [
          {
            id: programId,
            name: 'x 프로그램',
            organizer: '합성 운영처',
            trackType: 'EXTRACURRICULAR',
            lifecycle: 'PUBLISHED',
            applicationStartAt: '2026-01-01T00:00:00.000Z',
            applicationEndAt: '2026-12-01T00:00:00.000Z',
            endAt: '2026-12-31T00:00:00.000Z',
            description: '',
          },
        ],
        page: Number(url.searchParams.get('page')),
        pageSize: 20,
        totalItems: 40,
        totalPages: 2,
      },
    });
  });
  return requests;
}

test('프로그램 상세에서 뒤로 가면 검색 정렬 페이지가 복원되고 필터는 한 요청으로 페이지를 초기화한다', async ({
  page,
}) => {
  const programId = PROGRAM_ID;
  const requests = await mockPrograms(page, programId);
  await page.goto('/programs?sort=name&search=x&page=2');
  const card = page.locator('[data-slot="program-card"]').first();
  await expect(card).toBeVisible();
  await card.locator('xpath=ancestor::a').click();
  await expect(page).toHaveURL(new RegExp('/programs/' + programId + '$'));
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toBeVisible();
  await expect(heading).toContainText('x 프로그램');
  const restoredResponse = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === '/api/v1/programs' &&
      url.searchParams.get('page') === '2' &&
      url.searchParams.get('search') === 'x'
    );
  });
  await page.goBack();
  await restoredResponse;
  await expect(page).toHaveURL(/\/programs\?sort=name&search=x&page=2$/);
  await expect(page.getByLabel('프로그램명 검색')).toHaveValue('x');
  await expect(page.getByLabel('프로그램 정렬 기준')).toHaveValue('name');
  await expect(card).toBeVisible();
  requests.length = 0;
  await page.setViewportSize({ width: 390, height: 844 });
  const response = page.waitForResponse((result) => {
    const url = new URL(result.url());
    return (
      url.pathname === '/api/v1/programs' &&
      url.searchParams.get('status') === 'recruiting'
    );
  });
  await page
    .locator('[data-slot="section-facet-chips"]')
    .getByRole('button', { name: /^모집/ })
    .click();
  await response;
  await expect(
    page.locator('[data-slot="program-card"]').first(),
  ).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0]?.searchParams.get('page')).toBe('1');
  expect(requests[0]?.searchParams.get('search')).toBe('x');
  expect(requests[0]?.searchParams.get('sort')).toBe('name');
});

test('잘못된 URL은 기본값으로 조회하고 빠른 검색은 마지막 값만 주소를 대체한다', async ({
  page,
}) => {
  const programId = PROGRAM_ID;
  const requests = await mockPrograms(page, programId);
  await page.goto('/programs?page=abc&sort=bad');
  await expect(
    page.locator('[data-slot="program-card"]').first(),
  ).toBeVisible();
  expect(requests[0]?.searchParams.get('page')).toBe('1');
  expect(requests[0]?.searchParams.has('sort')).toBe(false);
  const length = await page.evaluate(() => history.length);
  await page.clock.install();
  requests.length = 0;
  const response = page.waitForResponse((result) => {
    const url = new URL(result.url());
    return (
      url.pathname === '/api/v1/programs' &&
      url.searchParams.get('search') === 'xyz'
    );
  });
  const search = page.getByLabel('프로그램명 검색');
  await search.fill('x');
  await search.fill('xy');
  await search.fill('xyz');
  await page.clock.runFor(300);
  await response;
  await expect(search).toHaveValue('xyz');
  expect(requests.map((url) => url.searchParams.get('search'))).toEqual([
    'xyz',
  ]);
  expect(await page.evaluate(() => history.length)).toBe(length);
});

test('팀 상세에서 뒤로 가면 teams search와 page를 복원한다', async ({
  page,
}) => {
  const programId = PROGRAM_ID;
  const requests: URL[] = [];
  await page.route(
    '**/api/v1/programs/' + programId + '/applications?*',
    async (route) => {
      const url = new URL(route.request().url());
      requests.push(url);
      await route.fulfill({
        json: {
          items: [
            {
              id: 'synthetic-application',
              programId,
              status: 'SUBMITTED',
              submittedAt: '2026-10-01T00:00:00.000Z',
              rejectionReason: null,
              applicant: {
                id: 'synthetic-user',
                name: '합성 신청자',
                nickname: 'synthetic-member',
              },
              team: {
                id: TEAM_ID,
                name: 'x 팀',
                memberCount: 0,
                members: [],
              },
            },
          ],
          page: Number(url.searchParams.get('page')),
          pageSize: 20,
          totalItems: 40,
          totalPages: 2,
        },
      });
    },
  );
  await page.goto('/programs/' + programId + '/teams?search=x&page=2');
  await expect(page.getByLabel('팀 검색')).toHaveValue('x');
  const team = page.getByRole('table').locator('a[href*="/teams/"]').first();
  await expect(team).toBeVisible();
  await team.click();
  await expect(page).toHaveURL(new RegExp('/teams/[^/?]+$'));
  await expect(
    page.getByRole('heading', { name: 'x 팀', exact: true }),
  ).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(new RegExp('/teams\\?search=x&page=2$'));
  await expect(page.getByLabel('팀 검색')).toHaveValue('x');
  await expect(page.getByText('2 / 2', { exact: true })).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
  for (const request of requests) {
    expect(request.searchParams.get('search')).toBe('x');
    expect(request.searchParams.get('page')).toBe('2');
  }
});
