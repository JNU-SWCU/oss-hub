import { expect, test, type Page } from '@playwright/test';

const VIEWER = 'synthetic-004';
const SERIES = [
  { githubLogin: 'synthetic-001', ranks: [1, 1, 1], totals: [100, 200, 300] },
  { githubLogin: 'synthetic-002', ranks: [3, 3, 2], totals: [50, 90, 250] },
  { githubLogin: 'synthetic-003', ranks: [2, 2, 3], totals: [70, 150, 200] },
  { githubLogin: VIEWER, ranks: [8, 7, 4], totals: [10, 40, 180] },
  {
    githubLogin: 'synthetic-005',
    ranks: [null, null, 5],
    totals: [null, null, 150],
  },
  ...Array.from({ length: 7 }, (_unused, index) => ({
    githubLogin: `synthetic-${String(index + 6).padStart(3, '0')}`,
    ranks: [index + 4, index + 8, index + 6],
    totals: [20, 30, 140 - index * 10],
  })),
];
const PREVIOUS_RANKS = [2, 1, 3, 6, null, 4, 5, 7, 8, 9, 10, 11] as const;
const EXPECTED_CHANGE = {
  'synthetic-001': '▲1',
  'synthetic-002': '▼1',
  'synthetic-003': '–',
  [VIEWER]: '▲2',
  'synthetic-005': 'NEW',
  'synthetic-012': '▼1',
} as const;

const CHART = '[data-history-chart="ready"]';
const CURVE = 'path.recharts-line-curve';
const TICK = '.recharts-cartesian-axis-tick-value';
const TABLE_ROW = '[data-slot="table-body"] [data-slot="table-row"]';

const RANKING_PAGE = {
  year: 2026,
  items: SERIES.map((series, index) => ({
    rank: index + 1,
    previousRank: PREVIOUS_RANKS[index],
    githubLogin: series.githubLogin,
    commitCount: SERIES.length - index,
    pullRequestCount: 3,
    issueCount: 1,
    repositoryCount: 2,
    starCount: 4,
    total: series.totals.at(-1) ?? 0,
  })),
  page: 1,
  pageSize: 100,
  total: SERIES.length,
  dataAsOf: '2026-03-19T02:30:00.000Z',
  viewerClass: 'member',
  nextCycleAt: '2026-03-21T00:00:00.000Z',
};

const TIMELINE_BODY = {
  year: 2026,
  months: [1, 2, 3],
  series: SERIES,
};

const ALL_TIMELINE = {
  year: 'all',
  periods: ['2025-12', '2026-01', '2026-02'].map((month) => ({
    fromMonth: month,
    toMonth: month,
  })),
  series: [
    { githubLogin: 'all-leader', ranks: [1, 1, 1], totals: [300, 400, 600] },
  ],
};

async function mockRanking(
  page: Page,
  options: {
    readonly timelineStatus?: number;
    readonly rankingGate?: Promise<void>;
    readonly timelineGate?: Promise<void>;
  } = {},
) {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        isAuthenticated: true,
        user: {
          nickname: VIEWER,
          name: null,
          email: null,
          avatarUrl: null,
          memberKind: 'STUDENT',
          hasStaffAccess: false,
          hasAdminAccess: false,
          isProfileComplete: true,
        },
      }),
    }),
  );
  await page.route('**/api/v1/consents/current', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        policyVersion: '2026-11-01',
        requiredItems: [
          {
            key: 'privacy',
            label: '개인정보 수집·이용',
            documentUrl: '/policies/privacy',
          },
        ],
        acceptedPolicyVersion: '2026-11-01',
        consented: true,
        nextUrl: '/ranking',
      }),
    }),
  );
  await page.route('**/api/v1/team-invitations/received', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    }),
  );
  await page.route('**/api/v1/ranking/years*', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ years: [2026] }) }),
  );
  await page.route('**/api/v1/ranking/timeline*', async (route) => {
    await options.timelineGate;
    const year = new URL(route.request().url()).searchParams.get('year');
    await route.fulfill({
      status: options.timelineStatus ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(
        options.timelineStatus === undefined
          ? year === 'all'
            ? ALL_TIMELINE
            : TIMELINE_BODY
          : {},
      ),
    });
  });
  await page.route('**/api/v1/ranking?*', async (route) => {
    await options.rankingGate;
    const year = new URL(route.request().url()).searchParams.get('year');
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        year === 'all'
          ? {
              ...RANKING_PAGE,
              year,
              items: [
                {
                  ...RANKING_PAGE.items[0],
                  githubLogin: 'all-leader',
                  total: 600,
                },
              ],
              total: 1,
            }
          : RANKING_PAGE,
      ),
    });
  });
}

async function openRanking(
  page: Page,
  options: { readonly timelineStatus?: number } = {},
) {
  await mockRanking(page, options);
  await page.goto('/ranking?year=2026');
  await expect(page.locator(TABLE_ROW)).toHaveCount(SERIES.length);
}

for (const [width, first] of [
  [412, 'ranking'],
  [412, 'timeline'],
  [1440, 'ranking'],
  [1440, 'timeline'],
] as const) {
  test(`${width}px 랭킹 표의 시작 위치를 유지한다 (${first} 응답 먼저)`, async ({
    page,
  }, testInfo) => {
    const ranking = Promise.withResolvers<void>();
    const timeline = Promise.withResolvers<void>();
    await page.setViewportSize({ width, height: 823 });
    await mockRanking(page, {
      rankingGate: ranking.promise,
      timelineGate: timeline.promise,
    });
    const chart = page.locator('main [data-history-chart]:visible');
    const table = page.getByRole('region', { name: '활동 랭킹 표' });
    const clock = page.locator('[data-slot="program-countdown-clock"]:visible');
    const completeRanking = async () => {
      ranking.resolve();
      await expect(clock).toBeVisible();
      await expect(page.locator(TABLE_ROW)).toHaveCount(SERIES.length);
    };
    const completeTimeline = async () => {
      timeline.resolve();
      await expect(page.locator(CHART)).toBeVisible();
    };
    try {
      await page.goto('/ranking?year=2026');
      await expect(chart.getByRole('status')).toHaveText(
        '순위 변화를 그리는 중입니다…',
      );
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
      const tableTop = await table.evaluate(
        (el) => el.getBoundingClientRect().top,
      );
      const chartBox = await chart.boundingBox();
      const assertGeometry = async () => {
        await expect(async () => {
          expect(
            await table.evaluate((el) => el.getBoundingClientRect().top),
          ).toBeCloseTo(tableTop, 0);
          const box = await chart.boundingBox();
          expect(box?.y).toBeCloseTo(chartBox?.y ?? Number.NaN, 0);
          expect(box?.height).toBeCloseTo(chartBox?.height ?? Number.NaN, 0);
        }).toPass();
      };

      if (first === 'ranking') await completeRanking();
      else await completeTimeline();
      await assertGeometry();

      if (first === 'ranking') await completeTimeline();
      else await completeRanking();
      await assertGeometry();
      if (width === 1440 && first === 'timeline') {
        await page.screenshot({
          path: testInfo.outputPath('ranking-desktop-calendar-year.png'),
          fullPage: true,
        });
      }
    } finally {
      ranking.resolve();
      timeline.resolve();
    }
  });
}

async function changeText(page: Page, login: string): Promise<string> {
  const row = page.locator(TABLE_ROW, { hasText: login });
  return (await row.locator('[data-rank-change]').innerText()).trim();
}

test('구성원은 서버가 보낸 계열 수만큼 선을 보고, 자기 선이 강조되며 범례는 상위 10명만 세운다', async ({
  page,
}) => {
  await openRanking(page);

  const curves = page.locator(`${CHART} ${CURVE}`);
  await expect(curves).toHaveCount(SERIES.length);
  await expect(page.locator(CHART)).toHaveAttribute(
    'data-viewer-login',
    VIEWER,
  );
  await expect(curves.last()).toHaveAttribute('stroke', 'var(--chart-3)');
  await expect(curves.last()).toHaveAttribute('stroke-width', '2.8');

  const legend = page.getByRole('list', { name: '상위 참여자' });
  await expect(legend.locator('[data-legend-login]')).toHaveCount(10);
  await expect(legend.locator(`[data-legend-login="${VIEWER}"]`)).toContainText(
    '나',
  );
  await expect(
    legend.locator('[data-legend-login="synthetic-012"]'),
  ).toHaveCount(0);

  const card = await page.locator(CHART).boundingBox();
  const legendBox = await legend.boundingBox();
  const plot = await page.locator(`${CHART} .recharts-surface`).boundingBox();
  expect(legendBox?.y ?? 0).toBeLessThan(plot?.y ?? 0);
  expect(legendBox?.x ?? 0).toBeLessThan((card?.x ?? 0) + 40);

  const february = await page
    .locator(`${CHART} ${TICK}`, { hasText: /^2월$/ })
    .boundingBox();
  const surface = await page
    .locator(`${CHART} .recharts-surface`)
    .boundingBox();
  if (february === null || surface === null) {
    throw new Error('February tick or plot is missing');
  }
  await page.mouse.move(
    february.x + february.width / 2,
    surface.y + surface.height / 2,
  );
  const tooltip = page.locator('[data-history-tooltip]');
  await expect(tooltip).toContainText('점');
  await expect(tooltip).toContainText('위');
});

test('범례를 누르면 그 선이 빠지고 다시 누르면 돌아온다', async ({ page }) => {
  await openRanking(page);
  const curves = page.locator(`${CHART} ${CURVE}`);
  const total = await curves.count();
  const first = page.locator(`${CHART} [data-legend-login] button`).first();

  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'false');
  await expect(curves).toHaveCount(total - 1);

  await first.click();
  await expect(first).toHaveAttribute('aria-pressed', 'true');
  await expect(curves).toHaveCount(total);
});

test('로그 축 버튼은 선을 유지한 채 세로축을 10배 눈금으로 바꾼다', async ({
  page,
}) => {
  await openRanking(page);
  const toggle = page.getByRole('button', { name: '로그 축' });
  const curves = page.locator(`${CHART} ${CURVE}`);
  const total = await curves.count();

  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(curves).toHaveCount(total);
  await expect(
    page.locator(`${CHART} .recharts-cartesian-axis-tick-value`, {
      hasText: /^100$/,
    }),
  ).toBeVisible();
});

test('순위표 변화 칸은 직전 수집 순위와 비교한 값을 쓴다', async ({ page }) => {
  await openRanking(page);

  for (const [login, expected] of Object.entries(EXPECTED_CHANGE)) {
    expect(await changeText(page, login)).toBe(expected);
  }
});

test('타임라인이 500 이어도 순위표와 변화 칸은 직전 수집 순위로 그린다', async ({
  page,
}) => {
  await openRanking(page, { timelineStatus: 500 });

  await expect(page.locator(CHART)).toHaveCount(0);
  await expect(page.locator('[data-history-chart="error"]')).toBeVisible();
  for (const [login, expected] of Object.entries(EXPECTED_CHANGE)) {
    expect(await changeText(page, login)).toBe(expected);
  }
});

test('390px 에서도 가로 스크롤이 생기지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRanking(page);
  await expect(page.locator(`${CHART} ${CURVE}`)).toHaveCount(SERIES.length);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  const tableOverflow = await page
    .getByRole('region', { name: '활동 랭킹 표' })
    .evaluate((region) => region.scrollWidth - region.clientWidth);
  expect(tableOverflow).toBeLessThanOrEqual(1);
});

test('모바일에서 전체와 2026년 그래프를 전환하고 자정에 새 연도를 표시한다', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install({ time: new Date('2026-12-31T14:50:00.000Z') });
  await mockRanking(page);
  await page.goto('/ranking');

  const chips = page.getByRole('group', { name: '연도 필터' });
  const all = chips.getByRole('button', { name: '전체', exact: true });
  const year = chips.getByRole('button', { name: '2026', exact: true });
  const ticks = page.locator(`${CHART} ${TICK}`);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(TABLE_ROW)).toContainText('all-leader');
  await expect(ticks.filter({ hasText: /^2025\.12$/ })).toBeVisible();
  await expect(ticks.filter({ hasText: /^2026\.02$/ })).toBeVisible();

  await year.click();
  await expect(page).toHaveURL(/\/ranking\?year=2026$/);
  await expect(year).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(TABLE_ROW)).toHaveCount(SERIES.length);
  await expect(ticks.filter({ hasText: /^1월$/ })).toBeVisible();
  await expect(ticks.filter({ hasText: /^12월$/ })).toBeVisible();
  await page.locator(CHART).scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath('ranking-mobile-calendar-year.png'),
    fullPage: true,
  });

  await all.click();
  await expect(page).toHaveURL(/\/ranking$/);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await expect(ticks.filter({ hasText: /^2025\.12$/ })).toBeVisible();

  await expect(chips.getByRole('button')).toHaveText(['전체', '2026']);
  await page.clock.fastForward('10:00');
  await expect(chips.getByRole('button')).toHaveText(['전체', '2027', '2026']);
  await expect(all).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({
    path: testInfo.outputPath('ranking-mobile-all-after-rollover.png'),
    fullPage: true,
  });
});
