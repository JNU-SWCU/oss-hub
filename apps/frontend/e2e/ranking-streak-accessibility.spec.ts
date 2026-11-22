import { expect, test, type Locator, type Page } from '@playwright/test';

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

const rank = /(?:^|[^0-9])1\s*위/u;
const days = /(?:^|[^0-9])123\s*일/u;
const meaning = new RegExp(`(?=.*${rank.source})(?=.*${days.source})`, 'u');

async function openLeaderRanking(page: Page): Promise<Locator> {
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
  const tag = page.getByRole('button', { name: meaning });
  await expect(page.locator('[data-streak-entered="true"]')).toHaveCount(1);
  return tag;
}

async function recordTooltipStates(tag: Locator) {
  const states = await tag.evaluateHandle((button) => {
    const seen: (string | null)[] = [];
    new MutationObserver(() => {
      seen.push(button.getAttribute('data-state'));
    }).observe(button, { attributes: true, attributeFilter: ['data-state'] });
    return seen;
  });
  return () => states.jsonValue();
}

async function expectMeaningDescribes(page: Page, tag: Locator) {
  const tooltip = page.getByRole('tooltip');
  await expect(tooltip).toHaveText(meaning);
  await expect(tag).toHaveAttribute(
    'aria-describedby',
    (await tooltip.getAttribute('id')) ?? '',
  );
  await expect(page.locator('[data-slot="tooltip-content"]')).toBeVisible();
}

test('the ranking leader exposes rank and tenure through the streak button name', async ({
  page,
}) => {
  const tag = await openLeaderRanking(page);

  await expect(tag).toHaveCount(1);
});

test('hovering then clicking the streak day count keeps its meaning open', async ({
  page,
}) => {
  const tag = await openLeaderRanking(page);

  await tag.hover();
  await expectMeaningDescribes(page, tag);
  const statesSinceHover = await recordTooltipStates(tag);
  await tag.click();

  await expect(page.locator('[data-streak-interaction="1"]')).toHaveCount(1);
  expect(await statesSinceHover()).toEqual([]);
  await expectMeaningDescribes(page, tag);
});

test('keyboard focus opens the streak meaning and Escape closes it', async ({
  page,
}) => {
  const tag = await openLeaderRanking(page);

  await page.locator('[data-streak-name]').focus();
  await page.keyboard.press('Tab');
  await expect(tag).toBeFocused();
  await expectMeaningDescribes(page, tag);

  await page.keyboard.press('Escape');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(tag).toHaveAttribute('data-state', 'closed');
});

test.describe('touch', () => {
  test.use({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });

  test('tapping the streak day count opens its meaning and repeated taps keep it open', async ({
    page,
  }) => {
    const tag = await openLeaderRanking(page);
    await expect(page.getByRole('tooltip')).toHaveCount(0);

    await tag.tap();
    await expect(page.locator('[data-streak-interaction="1"]')).toHaveCount(1);
    await expectMeaningDescribes(page, tag);
    const statesSinceFirstTap = await recordTooltipStates(tag);
    await tag.tap();

    await expect(page.locator('[data-streak-interaction="2"]')).toHaveCount(1);
    expect(await statesSinceFirstTap()).toEqual([]);
    await expectMeaningDescribes(page, tag);

    await page.getByRole('columnheader').first().tap();
    await expect(page.getByRole('tooltip')).toHaveCount(0);
  });
});
