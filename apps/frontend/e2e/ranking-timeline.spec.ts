import { expect, test, type Page } from '@playwright/test';

const VIEWER = 'synthetic-004';
const POINTS = ['2026-01-31', '2026-02-28', '2026-03-19'] as const;
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
const EXPECTED_CHANGE = {
  'synthetic-001': '–',
  'synthetic-002': '▲1',
  'synthetic-003': '▼1',
  [VIEWER]: '▲3',
  'synthetic-005': 'NEW',
  'synthetic-012': '▲2',
} as const;

const CHART = '[data-history-chart="ready"]';
const CURVE = 'path.recharts-line-curve';
const TABLE_ROW = '[data-slot="table-body"] [data-slot="table-row"]';

const RANKING_PAGE = {
  year: 2026,
  items: SERIES.map((series, index) => ({
    rank: index + 1,
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
  viewerClass: 'member',
  viewerGithubLogin: VIEWER,
  dataAsOf: '2026-03-19T02:30:00.000Z',
  points: POINTS.map((date, index) => ({ date, starEstimated: index === 0 })),
  series: SERIES,
};

async function openRanking(
  page: Page,
  options: { readonly timelineStatus?: number } = {},
) {
  await page.route('**/api/v1/ranking/years*', (route) =>
    route.fulfill({ status: 200, body: JSON.stringify({ years: [2026] }) }),
  );
  await page.route('**/api/v1/ranking/timeline*', (route) =>
    route.fulfill({
      status: options.timelineStatus ?? 200,
      contentType: 'application/json',
      body: JSON.stringify(
        options.timelineStatus === undefined ? TIMELINE_BODY : {},
      ),
    }),
  );
  await page.route('**/api/v1/ranking?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RANKING_PAGE),
    }),
  );
  await page.goto('/ranking?year=2026');
  await expect(page.locator(TABLE_ROW)).toHaveCount(SERIES.length);
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

  await page.locator(`${CHART} .recharts-surface`).hover();
  const tooltip = page.locator('[data-history-tooltip]');
  await expect(tooltip).toContainText('점');
  await expect(tooltip).toContainText('위');
});

test('순위표 변화 칸은 직전 달과 비교한 값을 쓴다', async ({ page }) => {
  await openRanking(page);

  for (const [login, expected] of Object.entries(EXPECTED_CHANGE)) {
    expect(await changeText(page, login)).toBe(expected);
  }
});

test('타임라인이 500 이어도 순위표는 그려지고 변화는 비워 둔다', async ({
  page,
}) => {
  await openRanking(page, { timelineStatus: 500 });

  await expect(page.locator(CHART)).toHaveCount(0);
  await expect(page.locator('[data-timeline-error]')).toBeVisible();
  expect(await changeText(page, 'synthetic-001')).toBe('');
  expect(await changeText(page, VIEWER)).toBe('');
});

test('390px 에서도 가로 스크롤이 생기지 않는다', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openRanking(page);
  await expect(page.locator(`${CHART} ${CURVE}`)).toHaveCount(SERIES.length);

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
