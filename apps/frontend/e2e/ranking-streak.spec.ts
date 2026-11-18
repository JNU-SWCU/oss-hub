import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  '../../.omo/evidence/ranking-streak/screenshots',
);
const TABLE_ROW = '[data-slot="table-body"] [data-slot="table-row"]';
const DAYS = [120, 35, 8, 3, 120, 35, 8, 3, 120, 35] as const;
const LOGINS = [
  '왕-leading',
  'LeftPrime',
  'RightPrime',
  'ChiefState',
  '이조-chief',
  '호조-chief',
  '예조-chief',
  '병조-chief',
  '형조-chief',
  '👩‍💻공조-chief',
] as const;

const RANKING_PAGE = {
  year: 2026,
  items: LOGINS.map((githubLogin, index) => ({
    rank: index + 1,
    previousRank: index + 1,
    githubLogin,
    commitCount: 100 - index,
    pullRequestCount: 20,
    issueCount: 10,
    repositoryCount: 5,
    starCount: 3,
    total: 138 - index,
    streak: {
      rankHeldSince: '2026-01-01',
      top10Since: '2026-01-01',
      rankHeldDays: DAYS[index],
      top10Days: DAYS[index],
    },
  })),
  page: 1,
  pageSize: 20,
  total: 10,
  dataAsOf: '2026-11-18T02:30:00.000Z',
  viewerClass: 'member',
  nextCycleAt: '2026-11-19T00:00:00.000Z',
};

async function mockRanking(page: Page) {
  await page.route('**/api/v1/auth/session', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        isAuthenticated: true,
        user: {
          nickname: 'ranking-viewer',
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
  await page.route('**/api/v1/ranking/timeline*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        year: 2026,
        months: [9, 10, 11],
        series: LOGINS.map((githubLogin, index) => ({
          githubLogin,
          ranks: [index + 1, index + 1, index + 1],
          totals: [100 - index, 120 - index, 138 - index],
        })),
      }),
    }),
  );
  await page.route('**/api/v1/ranking?*', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(RANKING_PAGE),
    }),
  );
}

async function openRanking(page: Page) {
  await page.goto('/ranking?year=2026');
  await expect(page.locator(TABLE_ROW)).toHaveCount(10);
  await expect(page.locator('[data-streak-entered="true"]')).toHaveCount(10);
}

async function capture(page: Page, name: string) {
  await page.locator(TABLE_ROW).first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    animations: 'allow',
  });
}

async function pauseAnimation(page: Page, animationName: string, time: number) {
  await page.evaluate(
    ({ name, currentTime }) => {
      for (const animation of document.getAnimations()) {
        if (
          animation instanceof CSSAnimation &&
          animation.animationName === name
        ) {
          animation.pause();
          animation.currentTime = currentTime;
        }
      }
    },
    { name: animationName, currentTime: time },
  );
}

test('조선 관직 스트릭 장식은 TOP 10만 꾸미고 표 geometry를 바꾸지 않는다', async ({
  page,
}) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await page.addInitScript(() => {
    let cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (
          'hadRecentInput' in entry &&
          entry.hadRecentInput === false &&
          'value' in entry &&
          typeof entry.value === 'number'
        ) {
          cls += entry.value;
        }
      }
      document.documentElement.dataset.rankingStreakCls = String(cls);
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await mockRanking(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRanking(page);
  await capture(page, 'static-1440');

  const geometry = await page.evaluate(async (rowSelector) => {
    const nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const readCls = () =>
      Number(document.documentElement.dataset.rankingStreakCls ?? '0');
    const rectOf = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
      };
    };
    const rows = [...document.querySelectorAll<HTMLElement>(rowSelector)];
    const region = document.querySelector<HTMLElement>(
      '[role="region"][aria-label="활동 랭킹 표"]',
    );
    const hidden = document.createElement('style');
    hidden.textContent =
      '[data-streak-headwear],[data-ranking-streak-tier]{display:none!important}';
    document.head.append(hidden);
    await nextFrame();
    const before = rows.map(rectOf);
    const hiddenScrollWidth = region?.scrollWidth ?? null;
    const clsBeforeDecoration = readCls();
    hidden.remove();
    await nextFrame();
    await nextFrame();
    const after = rows.map(rectOf);
    const clsAfterDecoration = readCls();
    return {
      before,
      after,
      hiddenScrollWidth,
      decoratedScrollWidth: region?.scrollWidth ?? null,
      clientWidth: region?.clientWidth ?? null,
      totalCls: clsAfterDecoration,
      decorationCls: clsAfterDecoration - clsBeforeDecoration,
    };
  }, TABLE_ROW);
  expect(geometry.after).toEqual(geometry.before);
  expect(geometry.decoratedScrollWidth).toBe(geometry.hiddenScrollWidth);
  expect(geometry.decorationCls).toBe(0);
  await writeFile(
    path.resolve(EVIDENCE_DIR, '../geometry.json'),
    `${JSON.stringify(geometry, null, 2)}\n`,
  );

  await page.reload();
  await expect(page.locator('[data-streak-entered="true"]')).toHaveCount(10);
  await pauseAnimation(page, 'hat-settle', 240);
  await capture(page, 'entry-bounce-midframe-1440');

  await page
    .locator('[data-ranking-streak-tier="celebration"]')
    .first()
    .click();
  await pauseAnimation(page, 'hat-wiggle', 190);
  await pauseAnimation(page, 'wing-left', 190);
  await pauseAnimation(page, 'wing-right', 190);
  await capture(page, 'wing-flap-midframe-1440');

  await pauseAnimation(page, 'streak-confetti', 300);
  await capture(page, 'confetti-midframe-1440');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(TABLE_ROW)).toHaveCount(10);
  await capture(page, 'static-390');
  await page
    .locator('[data-ranking-streak-tier="celebration"]')
    .first()
    .click();
  await pauseAnimation(page, 'streak-confetti', 300);
  await capture(page, 'confetti-midframe-390');
  const mobileOverflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
  }));
  expect(mobileOverflow.body).toBe(mobileOverflow.viewport);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(page.locator(TABLE_ROW)).toHaveCount(10);
  await capture(page, 'reduced-motion-1440');
  expect(
    await page.evaluate(() =>
      document
        .getAnimations()
        .flatMap((animation) =>
          animation instanceof CSSAnimation &&
          /hat-|wing-|streak-/.test(animation.animationName)
            ? [animation.animationName]
            : [],
        ),
    ),
  ).toEqual([]);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(TABLE_ROW)).toHaveCount(10);
  await capture(page, 'reduced-motion-390');
});
