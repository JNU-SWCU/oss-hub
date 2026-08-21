import { expect, test } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const evidenceDir = path.resolve('.omo/evidence/task-3-ranking-browser');

type ViewerClass = 'public' | 'staff';

function item(rank: number, viewerClass: ViewerClass) {
  return {
    rank,
    displayName: `synthetic-${rank}`,
    githubLogin: `synthetic-${rank}`,
    ...(viewerClass === 'staff' ? { name: `synthetic-name-${rank}` } : {}),
    department: 'synthetic-department',
    commitCount: 1,
    pullRequestCount: 2,
    issueCount: 3,
    repositoryCount: 4,
    starCount: 5,
    total: 15,
  };
}

function envelope(
  page: number,
  pageSize: number,
  total: number,
  viewerClass: ViewerClass,
) {
  const start = (page - 1) * pageSize + 1;
  const end = Math.min(start + pageSize - 1, total);
  return {
    year: 2026,
    items: Array.from({ length: Math.max(0, end - start + 1) }, (_, index) =>
      item(start + index, viewerClass),
    ),
    page,
    pageSize,
    total,
    dataAsOf: '2026-08-19T02:30:00.000Z',
    viewerClass,
    nextCycleAt: '2026-08-21T00:00:00.000Z',
  };
}

async function installRankingApi(
  page: import('@playwright/test').Page,
  options: {
    readonly viewerClass: ViewerClass;
    readonly failPageTwo?: boolean;
    readonly shortPage?: boolean;
  },
) {
  const requests: string[] = [];
  await page.route('**/api/v1/ranking*', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/years')) {
      await route.fallback();
      return;
    }
    const requestPage = Number(url.searchParams.get('page') ?? '1');
    const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
    requests.push(`page=${requestPage}&pageSize=${pageSize}`);
    if (options.failPageTwo && requestPage === 2 && pageSize === 100) {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: '{}',
      });
      return;
    }
    const response = envelope(requestPage, pageSize, 205, options.viewerClass);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(
        options.shortPage && requestPage === 2 && pageSize === 100
          ? { ...response, items: [] }
          : response,
      ),
    });
  });
  await page.route('**/api/v1/ranking/years*', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ years: [2026] }),
    });
  });
  return requests;
}

test('staff exports 205 synthetic rows with selected-year filename', async ({
  page,
}) => {
  const requests = await installRankingApi(page, { viewerClass: 'staff' });
  await page.goto('/ranking?year=2026');
  await expect(
    page.getByRole('button', { name: 'CSV 다운로드' }),
  ).toBeVisible();
  await expect(
    page.locator('time[dateTime="2026-08-19T02:30:00.000Z"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-slot="page-header-actions"] time'),
  ).toHaveCount(0);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'CSV 다운로드' }).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const bytes = await readFile(downloadPath as string);
  const csv = bytes.toString('utf8');
  expect(download.suggestedFilename()).toBe('ranking-2026.csv');
  expect(csv.startsWith('\uFEFF')).toBe(true);
  expect(csv.split('\r\n').length - 2).toBe(205);
  expect(
    requests.filter((request) => request.endsWith('pageSize=100')).join('|'),
  ).toBe('page=1&pageSize=100|page=2&pageSize=100|page=3&pageSize=100');
  await mkdir(evidenceDir, { recursive: true });
  await download.saveAs(path.join(evidenceDir, download.suggestedFilename()));
  await page.screenshot({
    path: path.join(evidenceDir, 'staff-ready.png'),
    fullPage: true,
  });
});

test('page-two failure announces failure and creates no download', async ({
  page,
}) => {
  await installRankingApi(page, { viewerClass: 'staff', failPageTwo: true });
  await page.goto('/ranking?year=2026');
  await expect(
    page.getByRole('button', { name: 'CSV 다운로드' }),
  ).toBeVisible();
  const downloads: string[] = [];
  page.on('download', (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page.getByRole('button', { name: 'CSV 다운로드' }).click();
  await expect(
    page.getByText('CSV를 준비하지 못했습니다. 다시 시도해 주세요.'),
  ).toBeVisible();
  expect(downloads).toEqual([]);
  await mkdir(evidenceDir, { recursive: true });
  await page.screenshot({
    path: path.join(evidenceDir, 'page-2-failure.png'),
    fullPage: true,
  });
});

test('short page announces failure and creates no download', async ({
  page,
}) => {
  await installRankingApi(page, { viewerClass: 'staff', shortPage: true });
  await page.goto('/ranking?year=2026');
  await expect(
    page.getByRole('button', { name: 'CSV 다운로드' }),
  ).toBeVisible();
  const downloads: string[] = [];
  page.on('download', (download) =>
    downloads.push(download.suggestedFilename()),
  );
  await page.getByRole('button', { name: 'CSV 다운로드' }).click();
  await expect(
    page.getByText('CSV를 준비하지 못했습니다. 다시 시도해 주세요.'),
  ).toBeVisible();
  expect(downloads).toEqual([]);
});

test('public viewer has no export action', async ({ page }) => {
  await installRankingApi(page, { viewerClass: 'public' });
  await page.goto('/ranking?year=2026');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.getByRole('button', { name: 'CSV 다운로드' })).toHaveCount(
    0,
  );
  await expect(
    page.locator('time[dateTime="2026-08-19T02:30:00.000Z"]'),
  ).toBeVisible();
  await expect(
    page.locator('[data-slot="page-header-actions"] time'),
  ).toHaveCount(0);
});
