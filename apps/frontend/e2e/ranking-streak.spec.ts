import { expect, test, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const EVIDENCE_DIR = path.resolve(
  process.cwd(),
  '../../.omo/evidence/ranking-egg-polish/after',
);
const TABLE_ROW = '[data-slot="table-body"] [data-slot="table-row"]';
const LOGINS = [
  '왕-leading-participant-with-long-name',
  'LeftPrime-participant',
  'RightPrime-participant',
  'ChiefState-participant',
  'rank-five-participant',
  'rank-six-participant',
  'rank-seven-participant',
  'rank-eight-participant',
  'rank-nine-participant',
  '👩‍💻rank-ten-participant',
] as const;

const DEPARTMENTS = [
  '인공지능융합학부 소프트웨어전공 매우 긴 학과명',
  '컴퓨터공학과 데이터사이언스 복수전공',
  '전자공학부 임베디드시스템 전공',
  '산업공학과 인간중심컴퓨팅 연구과정',
  '정보보호학과 네트워크보안 전공',
  '수학과 계산과학 연계전공',
  '통계학과 빅데이터 분석전공',
  '디자인학과 인터랙션디자인 전공',
  '경영학과 기술경영 연계전공',
  '기계공학부 지능형로봇 융합전공',
] as const;

const RANKING_PAGE = {
  year: 2026,
  items: LOGINS.map((githubLogin, index) => ({
    rank: index + 1,
    previousRank: index + 1,
    githubLogin,
    name: `매우 긴 참여자 이름 ${String(index + 1).padStart(2, '0')}`,
    department: DEPARTMENTS[index],
    commitCount: 100 - index,
    pullRequestCount: 20,
    issueCount: 10,
    repositoryCount: 5,
    starCount: 3,
    total: 138 - index,
    streak: {
      rankHeldSince: '2026-01-01',
      top10Since: '2026-01-01',
      rankHeldDays: index === 0 ? 120 : 3,
      top10Days: index === 0 ? 150 : 35,
    },
  })),
  page: 1,
  pageSize: 20,
  total: 10,
  dataAsOf: '2026-11-18T02:30:00.000Z',
  viewerClass: 'staff',
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
          memberKind: 'STAFF',
          hasStaffAccess: true,
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
  await page.evaluate(async () => {
    const hydrated = () =>
      document.querySelectorAll('[data-streak-entered="true"]').length === 10;
    if (!hydrated()) {
      await new Promise<void>((resolve) => {
        const observer = new MutationObserver(() => {
          if (hydrated()) {
            observer.disconnect();
            resolve();
          }
        });
        observer.observe(document.body, {
          childList: true,
          attributes: true,
          subtree: true,
          attributeFilter: ['data-streak-entered'],
        });
      });
    }
    await document.fonts.ready;
  });
}

async function capture(page: Page, name: string, fullPage = true) {
  await page.locator('nextjs-portal').evaluateAll((portals) => {
    for (const portal of portals) {
      if (portal instanceof HTMLElement) portal.style.display = 'none';
    }
  });
  await page.locator(TABLE_ROW).first().scrollIntoViewIfNeeded();
  await page.screenshot({
    path: path.join(EVIDENCE_DIR, `${name}.png`),
    animations: 'allow',
    fullPage,
  });
}

async function decorationClearance(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation instanceof CSSAnimation &&
            animation.animationName.includes('hat-settle'),
        )
        .map((animation) => animation.finished),
    );
  });
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
      if (name === null || tag === null || first === null || hat === null)
        throw new Error('Missing ranking decoration');
      const nameRect = name.getBoundingClientRect();
      const tagRect = tag.getBoundingClientRect();
      const firstRect = first.getBoundingClientRect();
      const hatRect = hat.getBoundingClientRect();
      const intersects = (left: DOMRect, right: DOMRect) =>
        Math.min(left.right, right.right) > Math.max(left.left, right.left) &&
        Math.min(left.bottom, right.bottom) > Math.max(left.top, right.top);
      const nameTagOverlap = intersects(nameRect, tagRect);
      const memberCell = anchor.closest('td, th');
      const row = anchor.closest('tr');
      const otherCells =
        row === null
          ? []
          : [...row.querySelectorAll<HTMLElement>('td, th')].filter(
              (cell) => cell !== memberCell,
            );
      const otherCellOverlap = otherCells.some((cell) => {
        const rect = cell.getBoundingClientRect();
        return intersects(hatRect, rect) || intersects(tagRect, rect);
      });
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
      const paths = [...hat.querySelectorAll('path, circle')].map((path) =>
        path.getBoundingClientRect(),
      );
      const paintLeft = Math.min(...paths.map((rect) => rect.left));
      const paintRight = Math.max(...paths.map((rect) => rect.right));
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
        paintedWidth: paintRight - paintLeft,
        aboveFirst:
          firstRect.top - Math.max(...paths.map((rect) => rect.bottom)),
        centeredOverFirst:
          paintLeft < firstRect.right && paintRight > firstRect.left,
        nameTagOverlap,
        nameCenterHitsLink: nameCenterTarget?.closest('a') === name,
        otherCellOverlap,
        hatCoverage: coveredHeight / firstRect.height,
        hatVisibleFraction: svgArea === 0 ? 0 : visibleArea / svgArea,
      };
    });
    window.scrollTo({ top: originalScrollY });
    return results;
  });
}

async function tableGeometry(page: Page) {
  const measure = (rowSelector: string) => {
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
    return {
      rows: rows.map(rectOf),
      scrollWidth: region?.scrollWidth ?? null,
      clientWidth: region?.clientWidth ?? null,
    };
  };
  const hidden = await page.addStyleTag({
    content:
      '[data-streak-headwear],[data-ranking-streak-tier]{display:none!important}',
  });
  await page.screenshot();
  const before = await page.evaluate(measure, TABLE_ROW);
  const meter = await page.evaluateHandle(() => {
    let score = 0;
    const collect = (entries: PerformanceEntry[]) => {
      for (const entry of entries) {
        if ('value' in entry && typeof entry.value === 'number')
          score += entry.value;
      }
    };
    const observer = new PerformanceObserver((list) =>
      collect(list.getEntries()),
    );
    observer.observe({ type: 'layout-shift' });
    return () => {
      collect(observer.takeRecords());
      observer.disconnect();
      return score;
    };
  });
  await hidden.evaluate((style) => {
    document.head.removeChild(style);
  });
  await page.screenshot();
  const after = await page.evaluate(measure, TABLE_ROW);
  return {
    before: before.rows,
    after: after.rows,
    hiddenScrollWidth: before.scrollWidth,
    decoratedScrollWidth: after.scrollWidth,
    clientWidth: after.clientWidth,
    decorationCls: await meter.evaluate((finish) => finish()),
  };
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

test('TOP 10 모자와 스트릭 장식은 행 텍스트와 표 geometry를 침범하지 않는다', async ({
  page,
}) => {
  await mkdir(EVIDENCE_DIR, { recursive: true });
  await mockRanking(page);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await openRanking(page);
  const desktopClearance = await decorationClearance(page);
  expect(desktopClearance.filter((row) => row.nameTagOverlap)).toEqual([]);
  expect(desktopClearance.filter((row) => !row.nameCenterHitsLink)).toEqual([]);
  expect(desktopClearance.filter((row) => row.otherCellOverlap)).toEqual([]);
  for (const row of desktopClearance) {
    expect(row.hatCoverage).toBe(0);
    expect(row.aboveFirst).toBeGreaterThanOrEqual(0);
    expect(row.centeredOverFirst).toBe(true);
    expect(row.paintedWidth).toBeGreaterThanOrEqual(22);
    expect(row.paintedWidth).toBeLessThanOrEqual(27);
  }
  expect(
    desktopClearance.filter((row) => row.hatVisibleFraction < 0.9),
  ).toEqual([]);
  const hydrationMotion = await page.evaluate(() => {
    const anchors = [
      ...document.querySelectorAll<HTMLElement>('[data-streak-entered]'),
    ];
    for (const anchor of anchors) anchor.removeAttribute('data-streak-entered');
    const animatedTag = document.querySelector<HTMLElement>(
      '[data-ranking-streak-tier="celebration"]',
    );
    const beforeHydration =
      animatedTag === null
        ? 'missing'
        : getComputedStyle(animatedTag, '::after').animationName;
    for (const anchor of anchors) anchor.dataset.streakEntered = 'true';
    const afterHydration =
      animatedTag === null
        ? 'missing'
        : getComputedStyle(animatedTag, '::after').animationName;
    return { beforeHydration, afterHydration };
  });
  expect(hydrationMotion.beforeHydration).toBe('none');
  expect(hydrationMotion.afterHydration).toContain('streak-shimmer');
  const staticHeadwear = await page.evaluate(() =>
    [...document.querySelectorAll<SVGElement>('[data-headwear-kind]')].map(
      (svg) => ({
        kind: svg.dataset.headwearKind,
        baseFill: getComputedStyle(
          svg.querySelector('[class*="hatBase"]') ?? svg,
        ).fill,
      }),
    ),
  );
  expect(new Set(staticHeadwear.map((item) => item.kind)).size).toBe(10);
  expect(new Set(staticHeadwear.map((item) => item.baseFill)).size).toBe(10);
  const effectLabels = await page
    .locator('[data-ranking-streak-tier]')
    .evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute('aria-label')),
    );
  expect(effectLabels).toEqual([
    '1위 유지 120일째',
    ...Array<string>(9).fill('TOP 10 유지 35일째'),
  ]);
  const accessibleTierNames = await page
    .locator('[data-streak-accessible-name]')
    .allTextContents();
  expect(new Set(accessibleTierNames).size).toBe(10);
  const visibleDayCounts = await page
    .locator('[data-ranking-streak-tier]')
    .allTextContents();
  expect(visibleDayCounts).toEqual([
    '120일째',
    ...Array<string>(9).fill('35일째'),
  ]);
  await capture(page, 'ranking-1440');

  const geometry = await tableGeometry(page);
  expect(geometry.after).toEqual(geometry.before);
  expect(geometry.decoratedScrollWidth).toBe(geometry.hiddenScrollWidth);
  expect(geometry.decorationCls).toBe(0);
  await openRanking(page);
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
  await openRanking(page);
  const mobileClearance = await decorationClearance(page);
  const mobileGeometry = await tableGeometry(page);
  expect(mobileClearance.filter((row) => row.nameTagOverlap)).toEqual([]);
  expect(mobileClearance.filter((row) => !row.nameCenterHitsLink)).toEqual([]);
  expect(mobileClearance.filter((row) => row.otherCellOverlap)).toEqual([]);
  for (const row of mobileClearance) {
    expect(row.hatCoverage).toBe(0);
    expect(row.aboveFirst).toBeGreaterThanOrEqual(0);
    expect(row.centeredOverFirst).toBe(true);
    expect(row.paintedWidth).toBeGreaterThanOrEqual(20);
  }
  expect(mobileClearance.filter((row) => row.hatVisibleFraction < 0.9)).toEqual(
    [],
  );
  expect(mobileGeometry.after).toEqual(mobileGeometry.before);
  expect(mobileGeometry.decoratedScrollWidth).toBe(
    mobileGeometry.hiddenScrollWidth,
  );
  expect(mobileGeometry.decorationCls).toBe(0);
  await capture(page, 'ranking-390', true);
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
  await openRanking(page);
  const reducedButton = page
    .locator('[data-ranking-streak-tier="celebration"]')
    .first();
  await reducedButton.click();
  await reducedButton.hover();
  expect(await page.locator('[data-streak-interaction="1"]').count()).toBe(0);
  await capture(page, 'ranking-reduced-motion-1440');
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
  await openRanking(page);
  const reducedKinds = await page
    .locator('[data-headwear-kind]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute('data-headwear-kind')),
    );
  expect(new Set(reducedKinds).size).toBe(10);
  await capture(page, 'ranking-reduced-motion-390', true);
});
