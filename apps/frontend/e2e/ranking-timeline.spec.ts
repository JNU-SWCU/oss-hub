import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const POINT_COUNT = 10;
const SERIES_COUNT = 300;
const TABLE_ROW_COUNT = 25;
const VIEWER_ORDER = 7;
const ROOKIE_ORDER = SERIES_COUNT - 1;
const ROOKIE_SILENT_POINTS = 2;
const MONTH_END_DAYS = [
  '31',
  '28',
  '31',
  '30',
  '31',
  '30',
  '31',
  '31',
  '30',
  '31',
] as const;
const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const PLAY_COMPLETION_TIMEOUT_MS = 30_000;
const CHART_ROOT = '[data-revealed-points]';
const FULLY_REVEALED = `[data-revealed-points="${String(POINT_COUNT)}"]`;
const TABLE_BODY_ROW = '[data-slot="table-body"] [data-slot="table-row"]';
const LINE_CURVE = 'g.rank-line path.recharts-line-curve';

type ViewerClass = 'public' | 'member';

interface TimelineSeriesBody {
  readonly githubLogin: string;
  readonly ranks: readonly (number | null)[];
  readonly totals?: readonly (number | null)[];
}

function syntheticLogin(order: number): string {
  return `synthetic-timeline-${String(order + 1)}`;
}

function timelinePoints(): { date: string; starEstimated: boolean }[] {
  return Array.from({ length: POINT_COUNT }, (_unused, index) => ({
    date: `2026-${String(index + 1).padStart(2, '0')}-${MONTH_END_DAYS[index] ?? '28'}`,
    starEstimated: index < POINT_COUNT - 1,
  }));
}

function ranksFor(order: number): (number | null)[] {
  return Array.from({ length: POINT_COUNT }, (_unused, index) => {
    if (order === ROOKIE_ORDER && index < ROOKIE_SILENT_POINTS) return null;
    return ((order + (POINT_COUNT - 1 - index)) % SERIES_COUNT) + 1;
  });
}

function timelineSeries(viewerClass: ViewerClass): TimelineSeriesBody[] {
  return Array.from({ length: SERIES_COUNT }, (_unused, order) => {
    const ranks = ranksFor(order);
    const series: TimelineSeriesBody = {
      githubLogin: syntheticLogin(order),
      ranks,
    };
    if (viewerClass === 'public') return series;
    return {
      ...series,
      totals: ranks.map((rank) =>
        rank === null ? null : (SERIES_COUNT - rank) * 3,
      ),
    };
  });
}

function timelineBody(viewerClass: ViewerClass) {
  return {
    year: 2026,
    viewerClass,
    viewerGithubLogin:
      viewerClass === 'member' ? syntheticLogin(VIEWER_ORDER) : null,
    dataAsOf: '2026-08-19T02:30:00.000Z',
    points: timelinePoints(),
    series: timelineSeries(viewerClass),
  };
}

function rankingItem(rank: number, viewerClass: ViewerClass) {
  const open = {
    rank,
    githubLogin: syntheticLogin(rank - 1),
    commitCount: 1,
    pullRequestCount: 2,
  };
  if (viewerClass === 'public') return open;
  return {
    ...open,
    issueCount: 3,
    repositoryCount: 4,
    starCount: 5,
    total: 15,
  };
}

function rankingEnvelope(viewerClass: ViewerClass) {
  return {
    year: 2026,
    items: Array.from({ length: TABLE_ROW_COUNT }, (_unused, index) =>
      rankingItem(index + 1, viewerClass),
    ),
    page: 1,
    pageSize: 100,
    total: TABLE_ROW_COUNT,
    dataAsOf: '2026-08-19T02:30:00.000Z',
    viewerClass,
    nextCycleAt: '2026-08-21T00:00:00.000Z',
  };
}

async function installRankingTimelineApi(
  page: Page,
  options: {
    readonly viewerClass: ViewerClass;
    readonly failTimeline?: boolean;
  },
) {
  await page.route('**/api/v1/ranking?*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(rankingEnvelope(options.viewerClass)),
    });
  });
  await page.route('**/api/v1/ranking/years*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ years: [2026] }),
    });
  });
  await page.route('**/api/v1/ranking/timeline*', async (route) => {
    if (options.failTimeline === true) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}',
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(timelineBody(options.viewerClass)),
    });
  });
}

async function saveEvidence(page: Page, testInfo: TestInfo, suffix: string) {
  const directory = path.resolve(
    testInfo.project.testDir,
    '../../..',
    '.omo/evidence',
  );
  await mkdir(directory, { recursive: true });
  await page.screenshot({
    path: path.join(directory, `ranking-timeline-${suffix}.png`),
    fullPage: true,
  });
}

async function expectChartAboveTable(page: Page) {
  const chart = page.locator(CHART_ROOT);
  const table = page.locator('[data-slot="table-container"]');
  await expect(chart).toBeVisible();
  await expect(table).toBeVisible();
  const chartBox = await chart.boundingBox();
  const tableBox = await table.boundingBox();
  if (chartBox === null || tableBox === null) {
    throw new Error('chart and table must both have a layout box');
  }
  expect(chartBox.y + chartBox.height).toBeLessThanOrEqual(tableBox.y);
}

test('member sees 300 rank lines above the table with the viewer line highlighted', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await installRankingTimelineApi(page, { viewerClass: 'member' });
  await page.goto('/ranking?year=2026');

  await expect(page.locator(CHART_ROOT)).toBeVisible();
  await expect(page.locator(LINE_CURVE)).toHaveCount(SERIES_COUNT);
  await expect(page.locator('[data-viewer-line]')).toHaveCount(1);
  await expect(page.locator('[data-org-membership-hint]')).toBeVisible();
  await expect(page.locator('[data-star-estimated-note]')).toBeVisible();
  await expect(page.locator(TABLE_BODY_ROW)).toHaveCount(TABLE_ROW_COUNT);
  await expectChartAboveTable(page);

  await saveEvidence(page, testInfo, 'desktop');
});

test('anonymous viewer gets the same lines without a viewer line or org hint', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await installRankingTimelineApi(page, { viewerClass: 'public' });
  await page.goto('/ranking?year=2026');

  await expect(page.locator(CHART_ROOT)).toBeVisible();
  await expect(page.locator(LINE_CURVE)).toHaveCount(SERIES_COUNT);
  await expect(page.locator('[data-viewer-line]')).toHaveCount(0);
  await expect(page.locator('[data-org-membership-hint]')).toHaveCount(0);
  await expectChartAboveTable(page);
});

test('play restarts the reveal and walks through every month', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await installRankingTimelineApi(page, { viewerClass: 'member' });
  await page.goto('/ranking?year=2026');

  await expect(page.locator(LINE_CURVE)).toHaveCount(SERIES_COUNT);
  await expect(page.locator(FULLY_REVEALED)).toBeVisible();

  const play = page.getByRole('button', { name: '재생' });
  await play.click();
  await expect(page.locator(FULLY_REVEALED)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '정지' })).toBeVisible();

  await expect(page.locator(FULLY_REVEALED)).toBeVisible({
    timeout: PLAY_COMPLETION_TIMEOUT_MS,
  });
  await expect(play).toBeVisible();
});

test('reduced motion reveals every month without play controls', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await installRankingTimelineApi(page, { viewerClass: 'member' });
  await page.goto('/ranking?year=2026');

  await expect(page.locator(LINE_CURVE)).toHaveCount(SERIES_COUNT);
  await expect(page.locator(FULLY_REVEALED)).toBeVisible();
  await expect(page.getByRole('button', { name: '재생' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '정지' })).toHaveCount(0);
});

test('mobile keeps the chart inside its own horizontal scroll container', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(MOBILE_VIEWPORT);
  await installRankingTimelineApi(page, { viewerClass: 'member' });
  await page.goto('/ranking?year=2026');

  await expect(page.locator(CHART_ROOT)).toBeVisible();
  await expect(page.locator(LINE_CURVE)).toHaveCount(SERIES_COUNT);
  await expectChartAboveTable(page);

  const chartBox = await page.locator(CHART_ROOT).boundingBox();
  if (chartBox === null) {
    throw new Error('chart must have a layout box');
  }
  expect(chartBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

  const scroller = await page.evaluate(() => {
    const surface = document.querySelector('.recharts-surface');
    const root = document.querySelector('[data-revealed-points]');
    if (surface === null || root === null) return null;
    let node = surface.parentElement;
    while (node !== null && node !== document.body) {
      const overflow = node.scrollWidth - node.clientWidth;
      if (overflow > 1) return { insideChart: root.contains(node), overflow };
      node = node.parentElement;
    }
    return { insideChart: false, overflow: 0 };
  });
  expect(scroller).not.toBeNull();
  expect(scroller?.insideChart).toBe(true);
  expect(scroller?.overflow ?? 0).toBeGreaterThan(1);

  await saveEvidence(page, testInfo, 'mobile');
});

test('timeline failure shows an inline error and keeps the ranking table', async ({
  page,
}, testInfo) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await installRankingTimelineApi(page, {
    viewerClass: 'member',
    failTimeline: true,
  });
  await page.goto('/ranking?year=2026');

  await expect(page.locator('[data-timeline-error]')).toBeVisible();
  await expect(page.locator(TABLE_BODY_ROW)).toHaveCount(TABLE_ROW_COUNT);
  await expect(page.locator(CHART_ROOT)).toHaveCount(0);

  await saveEvidence(page, testInfo, 'failure');
});
