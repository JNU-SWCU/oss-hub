import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
  type TestInfo,
} from '@playwright/test';
import { STAFF_INSIGHTS_FIXTURE } from '../src/features/staff-insights/fixtures';
import type { StaffInsightsFinderData } from '../src/features/staff-insights/leaderboard-panel';
import {
  PROGRAM_CATEGORIES,
  type InsightsView,
  type StaffInsightsSummary,
} from '../src/features/staff-insights/types';
import { apiPath } from '../src/lib/api-client';
import { hideNextDevTools } from './staff-insights-chart-layout';
import { installBrowserAudit } from './support/browser-audit';
import { CONSENTED_RESPONSE } from './support/member-access-fixture';
import { authenticatedSessionBody } from './support/session-mock';

const target = '/dashboard/insights';
const INSIGHTS_API = apiPath('/dashboard/staff/insights');
const FINDER_API = `${INSIGHTS_API}/students`;
const base = STAFF_INSIGHTS_FIXTURE;
const TAB_NAMES = {
  students: '순위',
  finder: '학생 찾기',
  groups: '학과·전공',
  programs: '프로그램',
} satisfies Record<InsightsView, string>;

const LONG_PROGRAM_NAMES = [
  '프로그램 1 — 전공·비전공 오픈소스 협업 기초 과정',
  '프로그램 2 — 지역 문제 해결형 공개 소프트웨어 실습',
  '프로그램 3 — 학과 연합 GitHub 프로젝트 집중 과정',
  '프로그램 4 — 오픈소스 기여자 성장 지원 프로그램',
  '프로그램 5 — 산학 협력 소프트웨어 개발 프로젝트',
  '프로그램 6 — 전공 융합 공개 저장소 운영 실습',
  '프로그램 7 — 학생 주도 커뮤니티 기여 챌린지',
  '프로그램 8 — 캡스톤 오픈소스 성과 공유 과정',
  '프로그램 👩‍💻 9 — 긴 이름 협업 실습',
  '프로그램 10 — 경계👩‍💻 유니코드 절단 회귀 과정',
  '프로그램 11 — 지역 연계 공개 소프트웨어 집중 과정',
  '프로그램 12 — 다학제 팀 프로젝트 성과 공유회',
] as const;

function oneDecimal(numerator: number, denominator: number): number | null {
  return denominator === 0
    ? null
    : Math.round((numerator / denominator) * 10) / 10;
}

const longPrograms: StaffInsightsSummary = {
  ...base,
  programs: LONG_PROGRAM_NAMES.map((name, index) => {
    const empty = index % 4 === 3;
    const swMajorCount = empty ? 0 : index + 1;
    const nonSwCount = empty ? 0 : index;
    const unregisteredCount = empty ? 0 : index % 2;
    const participantCount = swMajorCount + nonSwCount + unregisteredCount;
    const approvedCount = empty ? 0 : index + 2;
    const appliedCount = approvedCount + (index % 3) + 1;
    const dueRequirementCount = empty || index % 5 === 2 ? 0 : 12;
    const submittedRequirementCount = Math.min(dueRequirementCount, 5 + index);
    const repoTeamCount = empty || index % 5 === 1 ? 0 : approvedCount;
    const contributionCount = repoTeamCount === 0 ? 0 : 20 * (index + 1);
    return {
      ...base.programs[0],
      programId: `program-long-${index + 1}`,
      name,
      category: PROGRAM_CATEGORIES[index % PROGRAM_CATEGORIES.length],
      recruiting: index === 0 || empty,
      swMajorCount,
      nonSwCount,
      unregisteredCount,
      participantCount,
      appliedCount,
      approvedCount,
      competitionRatio: oneDecimal(appliedCount, approvedCount),
      dueRequirementCount,
      submittedRequirementCount,
      completionRate:
        dueRequirementCount === 0
          ? null
          : Math.round((submittedRequirementCount / dueRequirementCount) * 100),
      activeTeamCount: Math.min(repoTeamCount, (index % 3) + 1),
      repoTeamCount,
      contributionsPerParticipant:
        repoTeamCount === 0
          ? null
          : oneDecimal(contributionCount, participantCount),
    };
  }),
  programSummary: {
    ...base.programSummary,
    programCount: 12,
    recruitingCount: 4,
    approvedParticipantCount: 96,
    uniqueParticipantCount: 80,
    competitionRatio: 1.4,
    repeatParticipantCount: 12,
  },
};

const [firstLeader, inactiveLeader] = base.leaders.period.all;
const extraLeaders = Array.from({ length: 8 }, (_, index) => ({
  ...firstLeader,
  rank: index + 3,
  name: `합성 학생 ${index + 3}`,
  githubLogin: `synthetic-a${index + 3}`,
  studentId: String(130000 + index),
  department: base.departments[index % 6].department,
  total: 984 - index * 63,
  recentTotal: index === 0 ? null : 70 - index * 4,
  previousRank: index === 0 ? null : index + 5,
  collaborationRatio: index === 0 ? null : (index + 18) / 100,
}));

const comparison: StaffInsightsSummary = {
  ...base,
  departments: base.departments.map((row) =>
    row.department === '빅데이터융합학과'
      ? { ...row, recentPerStudent: 0 }
      : row,
  ),
  leaders: {
    recent: base.leaders.recent,
    period: {
      ...base.leaders.period,
      all: [
        { ...firstLeader, total: 1284, previousRank: 3 },
        { ...inactiveLeader, total: 1107, previousRank: 2 },
        ...extraLeaders,
      ],
    },
  },
  attentionStudents: [
    ...base.attentionStudents,
    ...extraLeaders
      .slice(0, 3)
      .map(({ name, githubLogin, department, total }) => ({
        name,
        githubLogin: `${githubLogin}-inactive`,
        studentId: null,
        department,
        total,
        lastActiveAt: null,
      })),
  ],
};

type FinderRow = StaffInsightsFinderData['rows'][number];

const finderRows: readonly FinderRow[] = comparison.leaders.period.all.map(
  (
    {
      name,
      githubLogin,
      studentId,
      major,
      total,
      recentTotal,
      collaborationRatio,
    },
    index,
  ) => ({
    name,
    githubLogin,
    studentId,
    major,
    total,
    recentTotal,
    collaborationRatio,
    programIds: index % 2 === 0 ? [base.programs[0].programId] : [],
  }),
);

const unknownStudent: FinderRow = {
  name: '합성 미수집 학생',
  githubLogin: 'synthetic-unknown',
  studentId: null,
  major: null,
  total: 0,
  recentTotal: null,
  collaborationRatio: null,
  programIds: [],
};
const inactiveStudent: FinderRow = {
  ...unknownStudent,
  name: '합성 미활동 학생',
  githubLogin: 'synthetic-inactive',
  recentTotal: 0,
};
const pageTwoStudent: FinderRow = {
  ...inactiveStudent,
  name: '합성 두 번째 페이지 학생',
  githubLogin: 'synthetic-page-two',
  studentId: '990099',
};
const firstFinderPage = [
  ...finderRows,
  unknownStudent,
  inactiveStudent,
  ...Array.from({ length: 6 }, (_, index) => ({
    ...inactiveStudent,
    name: `합성 대기 학생 ${index + 1}`,
    githubLogin: `synthetic-inactive-${index + 1}`,
  })),
];

function finderPage(
  rows: readonly FinderRow[],
  page = 1,
  total = rows.length,
): StaffInsightsFinderData {
  return { rows, page, total, pageSize: 20 };
}

function fulfillJson(route: Route, body: unknown) {
  return route.fulfill({ json: body });
}

async function routeInsightsApi(
  page: Page,
  options: {
    readonly summary?: StaffInsightsSummary;
    readonly actor?: 'staff' | 'student' | 'anonymous';
    readonly finder?: (params: URLSearchParams) => StaffInsightsFinderData;
    readonly summaryFailure?: number;
  } = {},
) {
  const { actor = 'staff', summary = base } = options;
  const summaryRequests: URL[] = [];
  const finderRequests: URL[] = [];
  await page.route(`**${apiPath('/**')}`, async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() !== 'GET')
      throw new Error(`Unexpected write to ${url.pathname}`);
    switch (url.pathname) {
      case apiPath('/auth/session'):
        return fulfillJson(
          route,
          actor === 'anonymous'
            ? { isAuthenticated: false }
            : authenticatedSessionBody(actor),
        );
      case apiPath('/consents/current'):
        return fulfillJson(route, CONSENTED_RESPONSE);
      case apiPath('/team-invitations/received'):
        return fulfillJson(route, []);
      case INSIGHTS_API: {
        summaryRequests.push(url);
        if (actor !== 'staff') break;
        if (options.summaryFailure !== undefined) {
          const status = options.summaryFailure;
          return route.fulfill({
            status,
            json: {
              type: 'about:blank',
              title: 'Error',
              status,
              detail: '합성 오류',
              instance: INSIGHTS_API,
              code: 'SYNTHETIC',
            },
          });
        }
        const year = url.searchParams.get('year');
        const scope =
          year === null
            ? { kind: 'all' }
            : { kind: 'calendar', year: Number(year) };
        return fulfillJson(route, { ...summary, scope });
      }
      case FINDER_API:
        finderRequests.push(url);
        if (actor !== 'staff' || options.finder === undefined) break;
        return route.fulfill({
          headers: { 'cache-control': 'private, no-store' },
          json: options.finder(url.searchParams),
        });
      case apiPath('/ranking/years'):
        return fulfillJson(route, { years: base.years });
      case apiPath('/ranking/timeline'):
        return fulfillJson(route, { year: 2026, months: [8], series: [] });
      case apiPath('/ranking'):
        return fulfillJson(route, {
          year: 2026,
          page: 1,
          pageSize: 100,
          total: 1,
          dataAsOf: base.dataAsOf,
          viewerClass: actor === 'student' ? 'member' : 'public',
          items: [
            {
              rank: 1,
              githubLogin: firstLeader.githubLogin,
              commitCount: 44,
              pullRequestCount: 0,
              total: 44,
            },
          ],
        });
    }
    throw new Error(`Unexpected intercepted GET ${url.pathname}`);
  });
  return { summaryRequests, finderRequests };
}

function tabs(page: Page): Locator {
  return page.getByRole('navigation', { name: '인사이트 보기' });
}

function viewTab(page: Page, view: InsightsView): Locator {
  return tabs(page).getByRole('link', { name: TAB_NAMES[view], exact: true });
}

function tableRegion(page: Page, name: string): Locator {
  return page.getByRole('region', { name, exact: true });
}

function scorecardRegion(page: Page): Locator {
  return tableRegion(page, '프로그램 성과표');
}

async function gotoInsights(
  page: Page,
  view: InsightsView = 'students',
  year?: number,
): Promise<void> {
  const params = new URLSearchParams();
  if (year !== undefined) params.set('year', String(year));
  if (view !== 'students') params.set('view', view);
  const query = params.toString();
  await page.goto(query ? `${target}?${query}` : target);
}

async function openInsights(
  page: Page,
  summary: StaffInsightsSummary,
  view: InsightsView,
): Promise<void> {
  await routeInsightsApi(page, { summary });
  await gotoInsights(page, view);
  await expect(viewTab(page, view)).toHaveAttribute('aria-current', 'page');
}

async function expectFirstColumnReadable(page: Page): Promise<void> {
  const region = scorecardRegion(page);
  const names = region.locator('[data-slot="program-name"]');
  await expect(names).toHaveCount(LONG_PROGRAM_NAMES.length);
  const regionBox = await region.boundingBox();
  if (regionBox === null) throw new Error('Missing scorecard bounds');
  for (const index of [0, LONG_PROGRAM_NAMES.length - 1]) {
    const nameCell = names.nth(index);
    const box = await nameCell.boundingBox();
    if (box === null) throw new Error('Missing program name bounds');
    expect(box.width).toBeGreaterThanOrEqual(120);
    expect(box.x).toBeGreaterThanOrEqual(regionBox.x - 1);
    expect(box.x + box.width).toBeLessThanOrEqual(
      regionBox.x + regionBox.width + 1,
    );
    expect(
      await nameCell.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
}

async function attachPng(
  testInfo: TestInfo,
  name: string,
  screenshot: (path: string) => Promise<unknown>,
): Promise<void> {
  const imagePath = testInfo.outputPath(...name.split('/'));
  await screenshot(imagePath);
  await testInfo.attach(name, { path: imagePath, contentType: 'image/png' });
}

async function captureV5(
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await attachPng(testInfo, `v5/${name}.png`, (path) =>
    page.screenshot({
      path,
      fullPage: true,
      animations: 'disabled',
      style: 'nextjs-portal { display: none; }',
    }),
  );
}

test.describe('staff insights comparison UX', () => {
  test.beforeAll(async ({ request }) => {
    test.setTimeout(180_000);
    const response = await request.get(target, { timeout: 180_000 });
    expect(response.status()).toBe(200);
  });

  for (const width of [1440, 768, 390] as const) {
    test(`reads the program scorecard at ${width}px with keyboard and 200% text`, async ({
      page,
    }, testInfo) => {
      const audit = installBrowserAudit(page);
      await page.setViewportSize({ width, height: 1000 });
      await openInsights(page, longPrograms, 'programs');
      await hideNextDevTools(page);
      const kpis = page.getByRole('region', { name: '프로그램 지표' });
      await expect(kpis).toContainText('운영 프로그램');
      await expect(kpis).toContainText('1.4:1');
      const region = scorecardRegion(page);
      await expect(region).toBeVisible();
      await expect(
        region.getByRole('columnheader', { name: /구성/ }),
      ).toHaveAttribute('aria-sort', 'descending');
      await expect(
        page.locator('[data-slot="program-scorecard-legend"]'),
      ).toHaveText(/SW전공.*비SW전공.*학과 미등록/);
      await expect(page.locator('main')).not.toContainText(/\d\s*팀/);
      await expectNoHorizontalOverflow(page);
      await expectFirstColumnReadable(page);
      await page.mouse.move(0, 0);
      await page.setViewportSize({
        width,
        height: width === 390 ? 3200 : 2000,
      });
      await attachPng(
        testInfo,
        `programs-scorecard/programs-${width}.png`,
        (path) => page.screenshot({ path, fullPage: true }),
      );
      await page.setViewportSize({ width, height: 1000 });

      if (width === 390) {
        const bounds = await region.evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
        expect(bounds.scrollWidth).toBeGreaterThan(bounds.clientWidth);
        await region.focus();
        await expect(region).toBeFocused();
        await region.press('ArrowRight');
        await expect
          .poll(() => region.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
        await expectFirstColumnReadable(page);
        await expectNoHorizontalOverflow(page);
        await page.mouse.move(0, 0);
        await attachPng(
          testInfo,
          'programs-scorecard/programs-390-scrolled.png',
          (path) => page.screenshot({ path, fullPage: true }),
        );
      }

      await region.evaluate((element) => {
        element.scrollLeft = 0;
      });
      await page.getByRole('button', { name: '완주율', exact: true }).click();
      await expect(
        region.getByRole('columnheader', { name: /완주/ }),
      ).toHaveAttribute('aria-sort', 'descending');
      await expect(page).toHaveURL(`${target}?view=programs`);

      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await region.evaluate((element) => {
        element.scrollLeft = 0;
      });
      await expect(kpis).toBeVisible();
      await expect(region).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await expectFirstColumnReadable(page);
      await page.getByRole('button', { name: '성과', exact: true }).click();
      await expect(
        region.getByRole('columnheader', { name: '성과', exact: true }),
      ).toHaveAttribute('aria-sort', 'descending');
      const outcomeValue = region
        .locator('tbody tr td:last-child > div > span')
        .first();
      await outcomeValue.evaluate((element) =>
        element.scrollIntoView({ block: 'center', inline: 'nearest' }),
      );
      expect(
        await outcomeValue.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return element.contains(
            document.elementFromPoint(
              box.x + box.width / 2,
              box.y + box.height / 2,
            ),
          );
        }),
      ).toBe(true);
      await region.evaluate((element) => {
        element.scrollLeft = 0;
      });
      await page.mouse.move(0, 0);
      await page
        .getByText('프로그램 성과표', { exact: true })
        .evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await attachPng(
        testInfo,
        `programs-scorecard/programs-${width}-200-text.png`,
        (path) => page.screenshot({ path, fullPage: true }),
      );
      audit.assertClean();
    });
  }

  for (const width of [1440, 390] as const) {
    test.describe(`${width}px`, () => {
      test.use({
        viewport: { width, height: width === 390 ? 844 : 900 },
        hasTouch: width === 390,
      });

      test('captures approved v5 ranking, metric hint, finder, and departments', async ({
        page,
      }, testInfo) => {
        const audit = installBrowserAudit(page);
        const requests = await routeInsightsApi(page, {
          summary: comparison,
          finder: (params) =>
            finderPage(
              finderRows.filter((row, index) => {
                const department = params.get('department');
                const minActivity = Number(params.get('minActivity') ?? '0');
                return (
                  (department === null ||
                    comparison.leaders.period.all[index].department ===
                      department) &&
                  row.total >= minActivity &&
                  (params.get('recentActivity') !== 'active' ||
                    (row.recentTotal !== null && row.recentTotal > 0))
                );
              }),
            ),
        });
        await gotoInsights(page, 'students', 2026);
        await expect(tabs(page).getByRole('link')).toHaveText(
          Object.values(TAB_NAMES),
        );
        await expect(viewTab(page, 'students')).toHaveAttribute(
          'aria-current',
          'page',
        );
        const period = page.getByLabel('기간', { exact: true });
        await expect(period.locator('option')).toHaveText([
          '전체',
          '2026년',
          '2025년',
        ]);
        await expect(period).toHaveValue('2026');
        const rank = tableRegion(page, '학생 순위 표');
        const attention = tableRegion(page, '관심 필요 학생 표');
        await expect(rank.locator('tbody tr')).toHaveCount(10);
        await expect(attention.locator('tbody tr')).toHaveCount(4);
        await expect(rank.getByRole('columnheader')).toHaveText([
          '순위',
          '이름',
          '학번',
          '학과',
          '전공',
          '활동 합계',
          '최근 30일 활동',
          '순위 변화',
          '협업 비율',
        ]);
        await expect(
          rank.getByRole('link', { name: /합성 학생 가/ }),
        ).toHaveAttribute(
          'href',
          `https://github.com/${firstLeader.githubLogin}`,
        );
        await expect(rank.getByText('급상승', { exact: true })).toHaveCount(1);
        await expect(
          rank.locator('tbody tr').nth(1).getByRole('cell').nth(6),
        ).toHaveText('0');
        await expect(
          rank.locator('tbody tr').nth(2).getByRole('cell').nth(6),
        ).toHaveText('—');
        await expect(
          page.getByRole('region', { name: '학생 지표' }),
        ).toContainText('이번 달 첫 기여 학생—');
        expect(requests.finderRequests).toHaveLength(0);
        await expectNoHorizontalOverflow(page);
        await captureV5(page, testInfo, `ranking-${width}`);

        const hint = rank.getByRole('button', { name: '협업 비율 설명' });
        const tooltip = page.getByRole('tooltip', { name: /PR \+ 이슈/ });
        await expect(tooltip).toHaveCount(0);
        await hint.scrollIntoViewIfNeeded();
        if (width === 390) {
          await hint.tap();
        } else {
          await hint.hover();
        }
        await expect(tooltip).toHaveText(/\(PR \+ 이슈\) ÷ 전체 활동/);
        await captureV5(page, testInfo, `metric-tooltip-${width}`);
        await page.keyboard.press('Escape');
        await expect(tooltip).toHaveCount(0);
        if (width === 1440) {
          await page.mouse.move(0, 0);
          await rank.getByRole('button', { name: '순위 변화 설명' }).focus();
          await page.keyboard.press('Tab');
          await expect(hint).toBeFocused();
          await expect(tooltip).toBeVisible();
          await page.keyboard.press('Escape');
        }

        await viewTab(page, 'finder').click();
        await expect(page).toHaveURL(`${target}?year=2026&view=finder`);
        await page
          .getByLabel('학과', { exact: true })
          .selectOption('소프트웨어공학과');
        await page
          .getByLabel('최소 활동량', { exact: true })
          .selectOption('200');
        await page
          .getByLabel('최근 30일 활동', { exact: true })
          .selectOption('active');
        await expect(page.getByLabel('검색', { exact: true })).toHaveValue('');
        await expect(
          page.getByLabel('프로그램 참여', { exact: true }),
        ).toHaveValue('');
        await expect
          .poll(() =>
            Object.fromEntries(
              requests.finderRequests.at(-1)?.searchParams ?? [],
            ),
          )
          .toMatchObject({
            year: '2026',
            department: '소프트웨어공학과',
            minActivity: '200',
            recentActivity: 'active',
          });
        await expect(
          page.getByText('검색 결과 2명', { exact: true }),
        ).toBeVisible();
        const finder = tableRegion(page, '학생 검색 결과 표');
        await expect(finder.locator('tbody tr')).toHaveCount(2);
        await expect(rank).toHaveCount(0);
        await expectNoHorizontalOverflow(page);
        await captureV5(page, testInfo, `finder-${width}`);

        await viewTab(page, 'groups').click();
        const groups = tableRegion(page, '학과·전공 표');
        await expect(groups).toBeVisible();
        await expect(groups.locator('tbody tr')).toHaveCount(6);
        await expect(groups.getByRole('rowheader').first()).toHaveText(
          '소프트웨어공학과',
        );
        await expect(groups.getByText('표본 적음')).toBeVisible();
        await expect(page.locator('main')).not.toContainText('기간 미적용');
        await expectNoHorizontalOverflow(page);
        await captureV5(page, testInfo, `departments-${width}`);
        const zero = groups
          .getByRole('row', { name: /빅데이터융합학과/ })
          .getByRole('cell')
          .last();
        await zero.scrollIntoViewIfNeeded();
        await expect(zero).toBeInViewport();
        await expect(zero).toHaveText('0.0');
        const unknown = groups
          .getByRole('row', { name: /인공지능학부/ })
          .getByRole('cell')
          .last();
        await unknown.scrollIntoViewIfNeeded();
        await expect(unknown).toBeInViewport();
        await expect(unknown).toHaveText('—');
        expect(
          new Set(requests.summaryRequests.map((url) => url.search)),
        ).toEqual(new Set(['?year=2026']));
        audit.assertClean();
      });
    });
  }

  test('sends global finder filters and sorting before rendering each bounded page', async ({
    page,
  }) => {
    const audit = installBrowserAudit(page);
    const requests = await routeInsightsApi(page, {
      finder: (params) => {
        if (params.get('search') === pageTwoStudent.studentId)
          return finderPage([pageTwoStudent]);
        if (params.get('recentActivity') === 'inactive')
          return finderPage([inactiveStudent]);
        if (params.get('sort') === 'studentId')
          return finderPage([pageTwoStudent]);
        if (params.get('page') === '2')
          return finderPage([pageTwoStudent], 2, 21);
        return finderPage(firstFinderPage, 1, 21);
      },
    });
    await gotoInsights(page, 'finder', 2026);
    const url = `${target}?year=2026&view=finder`;
    const finder = tableRegion(page, '학생 검색 결과 표');
    const pagination = page.getByRole('navigation', {
      name: '학생 검색 결과 페이지',
    });
    const next = pagination.getByRole('button', { name: '다음' });
    const previous = pagination.getByRole('button', { name: '이전' });
    const search = page.getByRole('searchbox', { name: '검색' });
    const params = () =>
      Object.fromEntries(requests.finderRequests.at(-1)?.searchParams ?? []);

    await expect(
      page.getByText('검색 결과 21명', { exact: true }),
    ).toBeVisible();
    await expect(finder.locator('tbody tr')).toHaveCount(20);
    const row = (name: string) =>
      finder.getByRole('row', { name: new RegExp(name) });
    await expect(row(unknownStudent.name!).getByRole('cell').nth(3)).toHaveText(
      '0',
    );
    await expect(row(unknownStudent.name!).getByRole('cell').nth(4)).toHaveText(
      '—',
    );
    await expect(
      row(inactiveStudent.name!).getByRole('cell').nth(4),
    ).toHaveText('0');
    await expect(row(pageTwoStudent.name!)).toHaveCount(0);
    await expect(finder.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /CSV/ })).toHaveCount(0);

    await next.click();
    await expect(row(pageTwoStudent.name!)).toBeVisible();
    await expect(finder.locator('tbody tr')).toHaveCount(1);
    await expect(next).toBeDisabled();
    expect(params()).toEqual({ year: '2026', page: '2' });
    await expect(page).toHaveURL(url);

    await previous.click();
    await expect(row(pageTwoStudent.name!)).toHaveCount(0);
    await search.fill(pageTwoStudent.studentId!);
    await expect(
      page.getByText('검색 결과 1명', { exact: true }),
    ).toBeVisible();
    await expect(row(pageTwoStudent.name!)).toBeVisible();
    expect(params()).toEqual({
      year: '2026',
      search: pageTwoStudent.studentId,
    });
    await expect(page).toHaveURL(url);

    await search.clear();
    await expect(next).toBeEnabled();
    await next.click();
    await expect(row(pageTwoStudent.name!)).toBeVisible();
    await finder.getByRole('button', { name: '학번 오름차순 정렬' }).click();
    await expect(
      page.getByText('검색 결과 1명', { exact: true }),
    ).toBeVisible();
    expect(params()).toEqual({
      year: '2026',
      sort: 'studentId',
      direction: 'asc',
    });
    await expect(
      finder.getByRole('columnheader', { name: /학번/ }),
    ).toHaveAttribute('aria-sort', 'ascending');

    await page
      .getByLabel('학과', { exact: true })
      .selectOption('소프트웨어공학과');
    await page
      .getByLabel('프로그램 참여', { exact: true })
      .selectOption(base.programs[0].programId);
    await page.getByLabel('최소 활동량', { exact: true }).selectOption('50');
    await page
      .getByLabel('최근 30일 활동', { exact: true })
      .selectOption('inactive');
    await expect(row(inactiveStudent.name!)).toBeVisible();
    await expect(row(unknownStudent.name!)).toHaveCount(0);
    expect(params()).toEqual({
      year: '2026',
      department: '소프트웨어공학과',
      programId: base.programs[0].programId,
      minActivity: '50',
      recentActivity: 'inactive',
      sort: 'studentId',
      direction: 'asc',
    });
    await expect(page).toHaveURL(url);
    audit.assertClean();
  });

  for (const [actor, gate] of [
    ['anonymous', '로그인이 필요합니다'],
    ['student', '접근 권한이 없습니다'],
  ] as const) {
    test(`does not fetch staff insights or render private student fields for ${actor}`, async ({
      page,
    }) => {
      const audit = installBrowserAudit(page);
      const requests = await routeInsightsApi(page, { actor });
      await gotoInsights(page, 'finder', 2026);
      await expect(page.getByRole('heading', { name: gate })).toBeVisible();
      await expect(tabs(page)).toHaveCount(0);

      await page.goto('/ranking?year=2026');
      const ranking = tableRegion(page, '활동 랭킹 표');
      await expect(
        ranking.getByRole('link', {
          name: new RegExp(firstLeader.githubLogin),
        }),
      ).toBeVisible();
      await expect(
        ranking.getByRole('columnheader', {
          name: /학번|협업 비율|최근 30일 활동/,
        }),
      ).toHaveCount(0);
      await expect(ranking).not.toContainText(firstLeader.studentId!);
      await expect(ranking).not.toContainText(firstLeader.name!);
      expect(requests.summaryRequests).toHaveLength(0);
      expect(requests.finderRequests).toHaveLength(0);
      audit.assertClean();
    });
  }

  for (const [status, message] of [
    [500, '인사이트를 불러오지 못했습니다.'],
    [403, '승인된 교직원 또는 관리자만 조회할 수 있습니다.'],
  ] as const) {
    test(`shows a staff insights failure state for HTTP ${status}`, async ({
      page,
    }) => {
      const audit = installBrowserAudit(page);
      await routeInsightsApi(page, { summaryFailure: status });
      await gotoInsights(page);
      await expect(page.getByText(message, { exact: true })).toBeVisible();
      await expect(tabs(page)).toHaveCount(0);
      audit.assertClean([{ status, path: INSIGHTS_API }]);
    });
  }

  test('renders empty ranking, department, and program states', async ({
    page,
  }, testInfo) => {
    const audit = installBrowserAudit(page);
    await routeInsightsApi(page, {
      summary: {
        ...base,
        cohorts: [],
        departments: [],
        programs: [],
        leaders: {
          period: { all: [], swMajor: [], nonSw: [] },
          recent: { all: [], swMajor: [], nonSw: [] },
        },
        attentionStudents: [],
      },
    });
    await gotoInsights(page);
    await expect(
      page.getByText('이 기간에 활동한 학생이 없습니다'),
    ).toBeVisible();
    await expect(page.getByText('관심이 필요한 학생이 없습니다')).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/NaN|0\/0/);
    await viewTab(page, 'groups').click();
    await expect(page.getByText('학과별 학생이 없습니다')).toBeVisible();
    await viewTab(page, 'programs').click();
    await expect(page.getByText('운영 중인 프로그램이 없습니다')).toBeVisible();
    await attachPng(testInfo, 'task-2-browser/empty-programs.png', (path) =>
      page.screenshot({ path, fullPage: true }),
    );
    audit.assertClean();
  });
});
