import { expect, test } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const phase = process.env.EVIDENCE_PHASE ?? 'after';
const evidenceDir = process.env.EVIDENCE_DIR ?? path.resolve('.evidence');

type Tier = 'public' | 'member' | 'staff';

const LOGINS = ['synthetic-top', 'synthetic-second', 'synthetic-newcomer'];

function row(rank: number, tier: Tier) {
  const base = {
    rank,
    githubLogin: LOGINS[rank - 1],
    commitCount: 130 - rank * 10,
    pullRequestCount: 24 - rank * 5,
  };
  const metrics = {
    issueCount: 17 - rank * 4,
    repositoryCount: 9 - rank * 2,
    starCount: 213 - rank * 50,
    total: 391 - rank * 80,
  };
  if (tier === 'public') {
    return phase === 'before' ? { ...base, ...metrics } : base;
  }
  if (tier === 'member') return { ...base, ...metrics };
  return {
    ...base,
    ...metrics,
    displayName: base.githubLogin,
    name: `synthetic-name-${rank}`,
    department: '소프트웨어공학과',
  };
}

function envelope(tier: Tier) {
  return {
    year: 2026,
    items: [1, 2, 3].map((rank) => row(rank, tier)),
    page: 1,
    pageSize: 20,
    total: 3,
    dataAsOf: '2026-08-19T02:30:00.000Z',
    viewerClass: tier,
    nextCycleAt: '2026-08-21T00:00:00.000Z',
  };
}

async function install(page: import('@playwright/test').Page, tier: Tier) {
  await page.route('**/api/v1/ranking*', async (route) => {
    const url = new URL(route.request().url());
    const body = url.pathname.endsWith('/years')
      ? { years: [2026] }
      : envelope(tier);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });
}

const tiers: readonly Tier[] =
  phase === 'before' ? ['public', 'staff'] : ['public', 'member', 'staff'];

for (const tier of tiers) {
  test(`capture ${tier} ${phase}`, async ({ page }) => {
    await mkdir(evidenceDir, { recursive: true });
    await install(page, tier);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/ranking?year=2026');
    await expect(page.getByText('synthetic-top').first()).toBeVisible();

    const headers = await page.locator('th').allInnerTexts();
    const firstRow = await page
      .locator('tbody tr')
      .first()
      .locator('td')
      .allInnerTexts();
    console.log(
      `EVIDENCE ${phase} ${tier} headers=${JSON.stringify(headers)} row1=${JSON.stringify(firstRow)}`,
    );

    await page.screenshot({
      path: path.join(evidenceDir, `ranking-${phase}-desktop-${tier}.png`),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByText('synthetic-top').first()).toBeVisible();
    await page.screenshot({
      path: path.join(evidenceDir, `ranking-${phase}-mobile-${tier}.png`),
      fullPage: true,
    });
  });
}
