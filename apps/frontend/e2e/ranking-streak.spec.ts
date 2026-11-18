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
  await page.route(/^https:\/\/github\.com\/.*\.png/, (route) =>
    route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 44 44"><circle cx="22" cy="22" r="22" fill="#64748b"/><circle cx="22" cy="17" r="8" fill="#f8fafc"/><path d="M8 42c2-10 7-15 14-15s12 5 14 15" fill="#f8fafc"/></svg>',
    }),
  );
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
  await page.locator('nextjs-portal').evaluateAll((portals) => {
    for (const portal of portals) {
      if (portal instanceof HTMLElement) portal.style.display = 'none';
    }
  });
  await page.locator(TABLE_ROW).first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    animations: 'allow',
  });
}

async function decorationClearance(page: Page) {
  return page.evaluate(() => {
    const originalScrollY = window.scrollY;
    const results = [
      ...document.querySelectorAll<HTMLElement>('[data-streak-entered]'),
    ].map((anchor) => {
      anchor.scrollIntoView({ block: 'center' });
      const name = anchor.querySelector<HTMLElement>('[data-streak-name]');
      const tag = anchor.querySelector<HTMLElement>(
        '[data-ranking-streak-tier]',
      );
      const first = anchor.querySelector<HTMLElement>(
        '[data-streak-first-character]',
      );
      const hat = anchor.querySelector<HTMLElement>('[data-streak-headwear]');
      if (name === null || tag === null || first === null || hat === null) {
        return {
          name: '',
          nameTagOverlap: true,
          nameCenterHitsLink: false,
          hatCoverage: 1,
          hatVisibleFraction: 0,
        };
      }
      const nameRect = name.getBoundingClientRect();
      const tagRect = tag.getBoundingClientRect();
      const firstRect = first.getBoundingClientRect();
      const hatRect = hat.getBoundingClientRect();
      const nameTagOverlap =
        Math.min(nameRect.right, tagRect.right) >
          Math.max(nameRect.left, tagRect.left) &&
        Math.min(nameRect.bottom, tagRect.bottom) >
          Math.max(nameRect.top, tagRect.top);
      const nameCenterTarget = document.elementFromPoint(
        nameRect.left + nameRect.width / 2,
        nameRect.top + nameRect.height / 2,
      );
      const coveredHeight = Math.max(
        0,
        Math.min(firstRect.bottom, hatRect.bottom) -
          Math.max(firstRect.top, hatRect.top),
      );
      const hatSvg = hat.querySelector<SVGElement>('svg');
      const svgRect = hatSvg?.getBoundingClientRect();
      let visibleLeft = svgRect?.left ?? 0;
      let visibleRight = svgRect?.right ?? 0;
      let visibleTop = svgRect?.top ?? 0;
      let visibleBottom = svgRect?.bottom ?? 0;
      let ancestor = hatSvg?.parentElement ?? null;
      while (ancestor !== null && svgRect !== undefined) {
        const style = getComputedStyle(ancestor);
        const ancestorRect = ancestor.getBoundingClientRect();
        if (['auto', 'clip', 'hidden', 'scroll'].includes(style.overflowX)) {
          visibleLeft = Math.max(visibleLeft, ancestorRect.left);
          visibleRight = Math.min(visibleRight, ancestorRect.right);
        }
        if (['auto', 'clip', 'hidden', 'scroll'].includes(style.overflowY)) {
          visibleTop = Math.max(visibleTop, ancestorRect.top);
          visibleBottom = Math.min(visibleBottom, ancestorRect.bottom);
        }
        ancestor = ancestor.parentElement;
      }
      const svgArea = (svgRect?.width ?? 0) * (svgRect?.height ?? 0);
      const visibleArea =
        Math.max(0, visibleRight - visibleLeft) *
        Math.max(0, visibleBottom - visibleTop);
      return {
        name: name.textContent ?? '',
        nameTagOverlap,
        nameCenterHitsLink: nameCenterTarget?.closest('a') === name,
        hatCoverage: coveredHeight / firstRect.height,
        hatVisibleFraction: svgArea === 0 ? 0 : visibleArea / svgArea,
      };
    });
    window.scrollTo({ top: originalScrollY });
    return results;
  });
}

async function tableGeometry(page: Page) {
  return page.evaluate(async (rowSelector) => {
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
}

async function pauseAnimation(
  page: Page,
  animationName: string,
  time: number,
): Promise<number> {
  return page.evaluate(
    ({ name, currentTime }) => {
      let paused = 0;
      for (const animation of document.getAnimations()) {
        if (
          animation instanceof CSSAnimation &&
          animation.animationName.includes(name)
        ) {
          animation.pause();
          animation.currentTime = currentTime;
          paused += 1;
        }
      }
      return paused;
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
  const desktopClearance = await decorationClearance(page);
  expect(desktopClearance.filter((row) => row.nameTagOverlap)).toEqual([]);
  expect(desktopClearance.filter((row) => !row.nameCenterHitsLink)).toEqual([]);
  expect(desktopClearance.filter((row) => row.hatCoverage > 0.2)).toEqual([]);
  expect(
    desktopClearance.filter((row) => row.hatVisibleFraction < 0.9),
  ).toEqual([]);
  const hydrationMotion = await page.evaluate(async () => {
    const nextFrame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const anchors = [
      ...document.querySelectorAll<HTMLElement>('[data-streak-entered]'),
    ];
    for (const anchor of anchors) anchor.removeAttribute('data-streak-entered');
    await nextFrame();
    const animatedTag = document.querySelector<HTMLElement>(
      '[data-ranking-streak-tier="celebration"]',
    );
    const beforeHydration =
      animatedTag === null
        ? 'missing'
        : getComputedStyle(animatedTag, '::after').animationName;
    for (const anchor of anchors) anchor.dataset.streakEntered = 'true';
    await nextFrame();
    const afterHydration =
      animatedTag === null
        ? 'missing'
        : getComputedStyle(animatedTag, '::after').animationName;
    return { beforeHydration, afterHydration };
  });
  expect(hydrationMotion.beforeHydration).toBe('none');
  expect(hydrationMotion.afterHydration).toContain('streak-shimmer');
  await capture(page, 'static-1440');

  const geometry = await tableGeometry(page);
  expect(geometry.after).toEqual(geometry.before);
  expect(geometry.decoratedScrollWidth).toBe(geometry.hiddenScrollWidth);
  expect(geometry.decorationCls).toBe(0);
  await page.reload();
  await expect(page.locator('[data-streak-entered="true"]')).toHaveCount(10);
  expect(await pauseAnimation(page, 'hat-settle', 240)).toBeGreaterThan(0);
  await capture(page, 'entry-bounce-midframe-1440');

  await page
    .locator('[data-ranking-streak-tier="celebration"]')
    .first()
    .click();
  expect(await pauseAnimation(page, 'hat-wiggle', 190)).toBeGreaterThan(0);
  expect(await pauseAnimation(page, 'wing-left', 190)).toBeGreaterThan(0);
  expect(await pauseAnimation(page, 'wing-right', 190)).toBeGreaterThan(0);
  await capture(page, 'wing-flap-midframe-1440');

  expect(await pauseAnimation(page, 'streak-confetti', 300)).toBeGreaterThan(0);
  await capture(page, 'confetti-midframe-1440');

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(page.locator(TABLE_ROW)).toHaveCount(10);
  const mobileClearance = await decorationClearance(page);
  const mobileGeometry = await tableGeometry(page);
  expect(mobileClearance.filter((row) => row.nameTagOverlap)).toEqual([]);
  expect(mobileClearance.filter((row) => !row.nameCenterHitsLink)).toEqual([]);
  expect(mobileClearance.filter((row) => row.hatCoverage > 0.2)).toEqual([]);
  expect(mobileClearance.filter((row) => row.hatVisibleFraction < 0.9)).toEqual(
    [],
  );
  expect(mobileGeometry.after).toEqual(mobileGeometry.before);
  expect(mobileGeometry.decoratedScrollWidth).toBe(
    mobileGeometry.hiddenScrollWidth,
  );
  expect(mobileGeometry.decorationCls).toBe(0);
  await capture(page, 'static-390');
  await page
    .locator('[data-ranking-streak-tier="celebration"]')
    .first()
    .click();
  expect(await pauseAnimation(page, 'streak-confetti', 300)).toBeGreaterThan(0);
  await capture(page, 'confetti-midframe-390');
  const mobileOverflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    body: document.body.scrollWidth,
  }));
  expect(mobileOverflow.body).toBe(mobileOverflow.viewport);
  await writeFile(
    path.resolve(EVIDENCE_DIR, '../geometry.json'),
    `${JSON.stringify(
      {
        desktop: geometry,
        mobile: mobileGeometry,
        desktopClearance,
        mobileClearance,
        mobileOverflow,
      },
      null,
      2,
    )}\n`,
  );

  const chartEvidence = await page.evaluate(() => ({
    dataLines: document.querySelectorAll('path.recharts-line-curve').length,
    avatarConnectors: document.querySelectorAll('[data-line-avatar] > line')
      .length,
    avatarRings: document.querySelectorAll('[data-line-avatar] > circle')
      .length,
    avatarImages: document.querySelectorAll('[data-line-avatar] > image')
      .length,
  }));
  await writeFile(
    path.resolve(EVIDENCE_DIR, '../chart-fixture.json'),
    `${JSON.stringify(
      {
        totals: LOGINS.map((githubLogin, index) => ({
          githubLogin,
          totals: [100 - index, 120 - index, 138 - index],
        })),
        ...chartEvidence,
      },
      null,
      2,
    )}\n`,
  );

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.reload();
  await expect(page.locator(TABLE_ROW)).toHaveCount(10);
  const reducedButton = page
    .locator('[data-ranking-streak-tier="celebration"]')
    .first();
  await reducedButton.click();
  await reducedButton.hover();
  await expect(page.locator('[data-streak-interaction="1"]')).toHaveCount(0);
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
