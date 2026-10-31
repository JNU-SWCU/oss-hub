import {
  expect,
  test,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const POINT_COUNT = 10;
const SERIES_COUNT = 300;
const TABLE_ROW_COUNT = 25;
const VIEWER_ORDER = 7;
const RIVAL_ORDER = VIEWER_ORDER - 1;
const ZERO_TOTAL_ORDER = SERIES_COUNT - 2;
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

const VIEWER_TOTALS = [
  10, 40, 120, 320, 700, 1220, 1700, 2140, 2577, 2870,
] as const;
const VIEWER_MONTH_SCORE = 293;
const VIEWER_MONTH_RANK = 8;
const VIEWER_END_RANK = 8;
const VIEWER_END_DELTA = '▲1';
const VIEWER_LABEL_PREFIX = syntheticLogin(VIEWER_ORDER).slice(0, 14);
const NUDGE_GAP = 1;
const BAND_COUNT = 5;
const BAND_CROSSINGS = ['1:3', '2:5', '3:6', '4:8'] as const;
const RHYTHM_PEAK_BARS = 1;
const RACER_COUNT_WITHOUT_ZERO_TOTAL_SERIES = SERIES_COUNT - 1;
const GROWTH_LAST_ROW = [
  '2870점',
  '+293점',
  '정상 공기 (상위 10%)',
  '1510점',
] as const;

const DESKTOP_VIEWPORT = { width: 1280, height: 800 } as const;
const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
const PLAY_COMPLETION_TIMEOUT_MS = 30_000;
const OVERFLOW_TOLERANCE_PX = 1;

const CHART_SHELL = '[data-active-tab]';
const GROWTH_PANEL = '[data-tab-panel="growth"]';
const MONTH_PANEL = '[data-tab-panel="month"]';
const RACE_PANEL = '[data-tab-panel="race"]';
const RACE_ROOT = '[data-revealed-points]';
const FULLY_REVEALED = `[data-revealed-points="${String(POINT_COUNT)}"]`;
const TABLE_BODY_ROW = '[data-slot="table-body"] [data-slot="table-row"]';
const LINE_CURVE = 'g.rank-line path.recharts-line-curve';
const TAB_LABELS = ['내 성장', '이번 달', '순위 레이스'] as const;

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

function totalsFor(order: number): (number | null)[] {
  if (order === ZERO_TOTAL_ORDER) {
    return Array.from({ length: POINT_COUNT }, () => 0);
  }
  if (order === VIEWER_ORDER) return [...VIEWER_TOTALS];
  let scored = 0;
  return ranksFor(order).map((rank) => {
    if (rank === null) return null;
    scored += 1;
    return scored * (SERIES_COUNT - order);
  });
}

function timelineSeries(viewerClass: ViewerClass): TimelineSeriesBody[] {
  return Array.from({ length: SERIES_COUNT }, (_unused, order) => {
    const series: TimelineSeriesBody = {
      githubLogin: syntheticLogin(order),
      ranks: ranksFor(order),
    };
    if (viewerClass === 'public') return series;
    return { ...series, totals: totalsFor(order) };
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

async function attributesOf(locator: Locator, name: string) {
  return locator.evaluateAll(
    (nodes, attribute: string) =>
      nodes.map((node) => node.getAttribute(attribute)),
    name,
  );
}

async function expectChartAboveTable(page: Page) {
  const chart = page.locator(CHART_SHELL);
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

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document:
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
  expect(overflow.body).toBeLessThanOrEqual(OVERFLOW_TOLERANCE_PX);
}

async function openMemberRanking(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
) {
  await page.setViewportSize(viewport);
  await installRankingTimelineApi(page, { viewerClass: 'member' });
  await page.goto('/ranking?year=2026');
  await expect(page.locator(CHART_SHELL)).toHaveAttribute(
    'data-active-tab',
    'growth',
  );
}

test('member lands on 내 성장 with crowd bands, my climb line and earned stickers', async ({
  page,
}, testInfo) => {
  await openMemberRanking(page, DESKTOP_VIEWPORT);

  await expect(
    page.getByRole('tablist', { name: '랭킹 그래프 보기' }),
  ).toBeVisible();
  await expect(page.getByRole('tab')).toHaveText([...TAB_LABELS]);
  expect(await attributesOf(page.getByRole('tab'), 'aria-selected')).toEqual([
    'true',
    'false',
    'false',
  ]);
  await expect(page.locator(GROWTH_PANEL)).toBeVisible();
  await expect(page.locator(MONTH_PANEL)).toBeHidden();
  await expect(page.locator(`${MONTH_PANEL} > *`)).toHaveCount(0);
  await expect(page.locator(`${RACE_PANEL} > *`)).toHaveCount(0);
  await expect(page.locator(RACE_ROOT)).toHaveCount(0);

  const growth = page.locator(GROWTH_PANEL);
  await expect(growth.locator('[data-growth-viewer-line]')).toHaveCount(1);
  await expect(growth.locator('[data-band]')).toHaveCount(BAND_COUNT);
  const crossings = growth.locator('[data-band-crossing]');
  await expect(crossings).toHaveCount(BAND_CROSSINGS.length);
  expect(await attributesOf(crossings, 'data-band-crossing')).toEqual([
    ...BAND_CROSSINGS,
  ]);
  await expect(growth.locator('[data-fresh]')).toHaveCount(0);

  const endLabel = growth.locator('[data-growth-endlabel]');
  await expect(endLabel).toContainText(
    `${String(VIEWER_END_RANK)}위 ${VIEWER_END_DELTA}`,
  );
  await expect(endLabel).toContainText(`@${VIEWER_LABEL_PREFIX}`);
  await expect(growth.locator('[data-this-month]')).toHaveAttribute(
    'data-this-month',
    String(VIEWER_MONTH_SCORE),
  );
  await expect(
    growth.getByText(`이번 달 +${String(VIEWER_MONTH_SCORE)}점`),
  ).toBeVisible();
  await expect(growth.locator('[data-star-estimated-note]')).toHaveCount(1);

  const lastRow = growth.locator('tbody tr').last();
  await expect(lastRow.locator('th')).toHaveText('10월');
  await expect(lastRow.locator('td')).toHaveText([...GROWTH_LAST_ROW]);

  await expect(page.locator(TABLE_BODY_ROW)).toHaveCount(TABLE_ROW_COUNT);
  await expectChartAboveTable(page);

  await saveEvidence(page, testInfo, 'growth');
});

test('keyboard opens 이번 달 with a podium, my row and the one-point nudge', async ({
  page,
}, testInfo) => {
  await openMemberRanking(page, DESKTOP_VIEWPORT);

  await page.getByRole('tab', { name: '내 성장' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator(CHART_SHELL)).toHaveAttribute(
    'data-active-tab',
    'month',
  );
  await expect(page.getByRole('tab', { name: '이번 달' })).toBeFocused();
  await expect(page.locator(MONTH_PANEL)).toBeVisible();
  await expect(page.locator(GROWTH_PANEL)).toBeHidden();

  const month = page.locator(MONTH_PANEL);
  const podium = month.locator('[data-podium-rank]');
  await expect(podium).toHaveCount(3);
  expect(await attributesOf(podium, 'data-podium-rank')).toEqual([
    '2',
    '1',
    '3',
  ]);
  await expect(month.locator('[data-podium-viewer]')).toHaveCount(0);
  await expect(month.locator('[data-startline]')).toHaveCount(0);

  const rows = month.locator('[data-rank-row]');
  await expect(rows).toHaveCount(3);
  expect(await attributesOf(rows, 'data-rank-row')).toEqual([
    String(VIEWER_MONTH_RANK - 1),
    String(VIEWER_MONTH_RANK),
    String(VIEWER_MONTH_RANK + 1),
  ]);
  const myRow = month.locator('[data-rank-row-viewer]');
  await expect(myRow).toHaveAttribute(
    'data-rank-row',
    String(VIEWER_MONTH_RANK),
  );
  await expect(myRow).toContainText(`나 · @${syntheticLogin(VIEWER_ORDER)}`);

  await expect(month.locator('[data-nudge]')).toHaveAttribute(
    'data-nudge',
    String(NUDGE_GAP),
  );
  await expect(
    month.getByText(
      `${String(NUDGE_GAP)}점 더 하면 한 칸 위 — @${syntheticLogin(RIVAL_ORDER)}와 ${String(NUDGE_GAP)}점 차`,
    ),
  ).toBeVisible();

  await expect(month.locator('[data-month-bar]')).toHaveCount(POINT_COUNT);
  await expect(month.locator('[data-month-bar-max]')).toHaveCount(
    RHYTHM_PEAK_BARS,
  );
  await expect(month.locator('[data-personal-best]')).toHaveCount(0);
  await expect(month.locator('[data-comeback]')).toHaveCount(0);

  await expect(
    month.getByText(`참가 ${String(RACER_COUNT_WITHOUT_ZERO_TOTAL_SERIES)}명`),
  ).toBeVisible();

  await expect(page.locator(`${RACE_PANEL} > *`)).toHaveCount(0);
  await expect(page.locator(TABLE_BODY_ROW)).toHaveCount(TABLE_ROW_COUNT);

  await saveEvidence(page, testInfo, 'month');
});

test('순위 레이스 tab keeps the 300-line race, the viewer line and playback', async ({
  page,
}, testInfo) => {
  await openMemberRanking(page, DESKTOP_VIEWPORT);

  await page.getByRole('tab', { name: '내 성장' }).focus();
  await page.keyboard.press('End');
  await expect(page.locator(CHART_SHELL)).toHaveAttribute(
    'data-active-tab',
    'race',
  );
  await expect(page.getByRole('tab', { name: '순위 레이스' })).toBeFocused();

  const race = page.locator(RACE_PANEL);
  await expect(race.locator(RACE_ROOT)).toBeVisible();
  await expect(race.locator(LINE_CURVE)).toHaveCount(SERIES_COUNT);
  await expect(race.locator('[data-viewer-line]')).toHaveCount(1);
  await expect(race.locator('[data-org-membership-hint]')).toBeVisible();
  await expect(race.locator('[data-star-estimated-note]')).toHaveCount(1);
  await expect(race.locator(FULLY_REVEALED)).toBeVisible();
  await expect(page.locator(TABLE_BODY_ROW)).toHaveCount(TABLE_ROW_COUNT);
  await expectChartAboveTable(page);

  const play = page.getByRole('button', { name: '재생' });
  await play.click();
  await expect(race.locator(FULLY_REVEALED)).toHaveCount(0);
  await expect(page.getByRole('button', { name: '정지' })).toBeVisible();

  await expect(race.locator(FULLY_REVEALED)).toBeVisible({
    timeout: PLAY_COMPLETION_TIMEOUT_MS,
  });
  await expect(play).toBeVisible();

  await saveEvidence(page, testInfo, 'race');
});

test('reduced motion reveals every month in 순위 레이스 without play controls', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openMemberRanking(page, DESKTOP_VIEWPORT);

  await page.getByRole('tab', { name: '순위 레이스' }).click();
  const race = page.locator(RACE_PANEL);
  await expect(race.locator(LINE_CURVE)).toHaveCount(SERIES_COUNT);
  await expect(race.locator(FULLY_REVEALED)).toBeVisible();
  await expect(page.getByRole('button', { name: '재생' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '정지' })).toHaveCount(0);
});

test('anonymous viewer gets the race card alone with no tabs, viewer line or totals', async ({
  page,
}) => {
  await page.setViewportSize(DESKTOP_VIEWPORT);
  await installRankingTimelineApi(page, { viewerClass: 'public' });
  await page.goto('/ranking?year=2026');

  const shell = page.locator(CHART_SHELL);
  await expect(shell).toHaveAttribute('data-active-tab', 'race');
  await expect(shell.locator(RACE_ROOT)).toBeVisible();
  await expect(shell.locator(LINE_CURVE)).toHaveCount(SERIES_COUNT);
  await expect(page.getByRole('tablist')).toHaveCount(0);
  await expect(page.locator('[data-tab]')).toHaveCount(0);
  await expect(page.locator('[data-tab-panel]')).toHaveCount(0);
  await expect(page.locator('[data-viewer-line]')).toHaveCount(0);
  await expect(page.locator('[data-growth-viewer-line]')).toHaveCount(0);
  await expect(page.locator('[data-org-membership-hint]')).toHaveCount(0);
  await expect(page.locator('[data-band]')).toHaveCount(0);
  await expect(page.locator('[data-this-month]')).toHaveCount(0);
  await expect(page.locator('[data-podium-rank]')).toHaveCount(0);

  const chartText = (await shell.textContent()) ?? '';
  expect(chartText).not.toMatch(/합계|점/u);
  await expect(page.getByRole('columnheader', { name: '합계' })).toHaveCount(0);
  await expectChartAboveTable(page);
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
  await expect(page.locator(CHART_SHELL)).toHaveCount(0);
  await expect(page.getByRole('tablist')).toHaveCount(0);

  await saveEvidence(page, testInfo, 'failure');
});

test('mobile keeps every tab inside the viewport with the race scroller contained', async ({
  page,
}, testInfo) => {
  await openMemberRanking(page, MOBILE_VIEWPORT);

  await expect(page.getByRole('tab')).toHaveCount(TAB_LABELS.length);
  const growth = page.locator(GROWTH_PANEL);
  await expect(growth).toBeVisible();
  await expect(growth.locator('[data-band]')).toHaveCount(BAND_COUNT);
  await expect(growth.locator('[data-growth-viewer-line]')).toHaveCount(1);
  await expectNoPageOverflow(page);

  await page.getByRole('tab', { name: '순위 레이스' }).click();
  const race = page.locator(RACE_PANEL);
  await expect(race.locator(LINE_CURVE)).toHaveCount(SERIES_COUNT);
  await expect(race.locator(FULLY_REVEALED)).toBeVisible();
  await expectNoPageOverflow(page);

  const chartBox = await race.locator(RACE_ROOT).boundingBox();
  if (chartBox === null) {
    throw new Error('chart must have a layout box');
  }
  expect(chartBox.width).toBeLessThanOrEqual(MOBILE_VIEWPORT.width);

  const scroller = await page.evaluate(() => {
    const surface = document.querySelector(
      '[data-tab-panel="race"] .recharts-surface',
    );
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
