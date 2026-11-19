import { expect, test } from '@playwright/test';

const leader = {
  rank: 1,
  previousRank: 1,
  githubLogin: 'synthetic-ranking-leader',
  commitCount: 12,
  pullRequestCount: 1,
  issueCount: 2,
  repositoryCount: 1,
  starCount: 0,
  total: 16,
  streak: {
    rankHeldSince: '2026-07-19',
    top10Since: '2026-07-19',
    rankHeldDays: 123,
    top10Days: 123,
  },
};

test('the ranking leader exposes rank and tenure through the streak button name', async ({
  page,
}) => {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({ json: { isAuthenticated: false, user: null } }),
  );
  await page.route('**/api/v1/ranking/years*', (route) =>
    route.fulfill({ json: { years: [2026] } }),
  );
  await page.route('**/api/v1/ranking/timeline*', (route) =>
    route.fulfill({ json: { year: 2026, months: [], series: [] } }),
  );
  await page.route('**/api/v1/ranking?*', (route) =>
    route.fulfill({
      json: {
        year: 2026,
        items: [leader],
        page: 1,
        pageSize: 20,
        total: 1,
        dataAsOf: '2026-11-18T02:30:00.000Z',
        viewerClass: 'public',
        nextCycleAt: '2026-11-19T00:00:00.000Z',
      },
    }),
  );

  await page.goto('/ranking?year=2026');
  const rank = /(?:^|[^0-9])1\s*위/u;
  const days = /(?:^|[^0-9])123\s*일/u;
  const name = new RegExp(`(?=.*${rank.source})(?=.*${days.source})`, 'u');
  await expect(page.getByRole('button', { name })).toHaveCount(1);
});
