import { expect, test, type Page } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';

const FIXTURE_TITLE = '스크롤 격리 합성 프로그램';
const PROGRAM_COUNT = 20;
const VIEWPORT = { width: 1440, height: 900 } as const;
const RECRUITING_NOW = new Date('2026-06-15T00:00:00.000Z');
const WHEEL_STEP_PX = 900;
const OVER_WHEEL_DELTA_PX = 5_000;
const OVER_WHEEL_COUNT = 4;
const BOTTOM_TOLERANCE_PX = 1;
const TOP_NAVIGATION = 'nav[data-slot="nav-bar"]';
const TOP_NAVIGATION_RATIONALE =
  'getByRole("banner") resolves to nothing: the shell renders nav[data-slot="nav-bar"] (components/nav-bar.tsx via app/_shell/shell-nav.tsx) and no <header>, so that selector is used and asserted unique';

interface ScrollMetrics {
  readonly mainScrollTop: number;
  readonly mainClientHeight: number;
  readonly mainScrollHeight: number;
  readonly documentScrollHeight: number;
  readonly innerHeight: number;
  readonly scrollY: number;
}

interface SrOnlyAudit {
  readonly count: number;
  readonly escaped: readonly string[];
}

interface Gate {
  readonly opened: Promise<void>;
  readonly open: () => void;
}

function gate(): Gate {
  let open: () => void = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

function programItem(index: number) {
  return {
    id: `scroll-program-${index}`,
    name: `${FIXTURE_TITLE} ${index + 1}`,
    organizer: '합성 주관',
    trackType: 'CURRICULAR',
    lifecycle: 'PUBLISHED',
    applicationStartAt: '2026-01-01T00:00:00.000Z',
    applicationEndAt: '2026-12-31T00:00:00.000Z',
    endAt: null,
    description: '스크롤 격리 e2e 전용 합성 항목',
  };
}

async function installScrollRoutes(
  page: Page,
  options: { readonly programsGate?: Gate } = {},
): Promise<void> {
  const items = Array.from({ length: PROGRAM_COUNT }, (_, index) =>
    programItem(index),
  );
  const statusCounts = {
    all: items.length,
    recruiting: items.length,
    in_progress: 0,
    upcoming: 0,
    ended: 0,
  };

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();

    if (method === 'GET' && path === '/api/v1/auth/session') {
      await route.fulfill({ json: { isAuthenticated: false } });
      return;
    }
    if (method === 'GET' && path === '/api/v1/programs/status-counts') {
      await route.fulfill({ json: statusCounts });
      return;
    }
    if (method === 'GET' && path === '/api/v1/programs') {
      await options.programsGate?.opened;
      await route.fulfill({
        json: {
          items,
          page: 1,
          pageSize: PROGRAM_COUNT,
          totalItems: items.length,
          totalPages: 1,
        },
      });
      return;
    }

    throw new Error(`Unexpected ${method} ${path}${url.search}`);
  });
}

async function readScrollMetrics(page: Page): Promise<ScrollMetrics> {
  return page.evaluate((): ScrollMetrics => {
    const main = document.querySelector('#main-content');
    if (!(main instanceof HTMLElement)) {
      throw new Error('#main-content missing');
    }
    return {
      mainScrollTop: main.scrollTop,
      mainClientHeight: main.clientHeight,
      mainScrollHeight: main.scrollHeight,
      documentScrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
      scrollY: window.scrollY,
    };
  });
}

async function auditSrOnly(page: Page): Promise<SrOnlyAudit> {
  return page.evaluate((): SrOnlyAudit => {
    const main = document.querySelector('#main-content');
    if (!(main instanceof HTMLElement)) {
      throw new Error('#main-content missing');
    }
    const elements = Array.from(main.querySelectorAll<HTMLElement>('.sr-only'));
    const escaped = elements
      .filter((element) => element.offsetParent === document.body)
      .map(
        (element) =>
          `${element.tagName.toLowerCase()}[role=${element.getAttribute('role') ?? '-'}] "${element.textContent?.trim().slice(0, 40) ?? ''}"`,
      );
    return { count: elements.length, escaped };
  });
}

function atBottom(metrics: ScrollMetrics): boolean {
  return (
    metrics.mainScrollTop + metrics.mainClientHeight >=
    metrics.mainScrollHeight - BOTTOM_TOLERANCE_PX
  );
}

async function settleFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

function expectContained(audit: SrOnlyAudit, state: string): void {
  expect(
    audit.count,
    `sr-only count inside #main-content (${state})`,
  ).toBeGreaterThan(0);
  expect(
    audit.escaped,
    `sr-only elements whose offsetParent is <body> (${state})`,
  ).toEqual([]);
}

test.describe('/programs 스크롤 격리 (AC1-AC3)', () => {
  test('목록 끝에서 강하게 휠 스크롤해도 문서가 밀리지 않고 sr-only가 #main-content 안에 머문다', async ({
    page,
  }, testInfo) => {
    testInfo.annotations.push({
      type: 'top-navigation-locator',
      description: TOP_NAVIGATION_RATIONALE,
    });
    const audit = installBrowserAudit(page);
    await installScrollRoutes(page);
    await page.setViewportSize(VIEWPORT);
    await page.clock.setFixedTime(RECRUITING_NOW);
    await page.goto('/programs');

    const before = await test.step(
      '(1) cards render and #main-content overflows',
      async () => {
        await expect(page.locator('[data-slot="program-card"]')).toHaveCount(
          PROGRAM_COUNT,
        );
        const metrics = await readScrollMetrics(page);
        expect(
          metrics.mainScrollHeight,
          `#main-content overflows (${JSON.stringify(metrics)})`,
        ).toBeGreaterThan(metrics.mainClientHeight);
        return metrics;
      },
    );

    await test.step('(2) pointer over visible #main-content', async () => {
      const box = await page.locator('#main-content').boundingBox();
      if (box === null) throw new Error('#main-content has no bounding box');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    });

    await test.step('(3) wheel in steps to the bottom', async () => {
      await page.mouse.wheel(0, WHEEL_STEP_PX);
      await expect
        .poll(async () => (await readScrollMetrics(page)).mainScrollTop, {
          message: '#main-content starts scrolling',
        })
        .toBeGreaterThan(0);
      await expect
        .poll(
          async () => {
            const metrics = await readScrollMetrics(page);
            if (atBottom(metrics)) return true;
            await page.mouse.wheel(0, WHEEL_STEP_PX);
            return false;
          },
          {
            message: 'wheel steps reach the bottom of #main-content',
            intervals: [100],
            timeout: 20_000,
          },
        )
        .toBe(true);
    });

    await test.step('(4) over-wheel keeps the document still', async () => {
      for (let index = 0; index < OVER_WHEEL_COUNT; index += 1) {
        await page.mouse.wheel(0, OVER_WHEEL_DELTA_PX);
      }
      await settleFrames(page);
      const after = await readScrollMetrics(page);
      await testInfo.attach('scroll-metrics', {
        body: JSON.stringify({ viewport: VIEWPORT, before, after }, null, 2),
        contentType: 'application/json',
      });
      expect(
        after.documentScrollHeight,
        `documentElement.scrollHeight equals innerHeight after over-wheel (${JSON.stringify(after)})`,
      ).toBe(after.innerHeight);
      expect(after.scrollY, 'window.scrollY stays 0 after over-wheel').toBe(0);
      const topNavigation = page.locator(TOP_NAVIGATION);
      await expect(topNavigation).toHaveCount(1);
      await expect(topNavigation).toBeInViewport();
    });

    await test.step('(5) sr-only stays inside #main-content', async () => {
      expectContained(await auditSrOnly(page), 'loaded');
    });

    audit.assertClean();
  });

  test('응답을 붙들어 둔 로딩 상태에서도 스켈레톤 live region이 #main-content 안에 머문다', async ({
    page,
  }) => {
    const audit = installBrowserAudit(page);
    const programsGate = gate();
    await installScrollRoutes(page, { programsGate });
    await page.setViewportSize(VIEWPORT);
    await page.clock.setFixedTime(RECRUITING_NOW);
    await page.goto('/programs');

    await test.step('(5) sr-only stays contained while loading', async () => {
      await expect(
        page.locator('#main-content [data-slot="skeleton"]'),
      ).toBeVisible();
      expectContained(await auditSrOnly(page), 'loading');
    });

    await test.step('(5) sr-only stays contained after release', async () => {
      programsGate.open();
      await expect(page.locator('[data-slot="program-card"]')).toHaveCount(
        PROGRAM_COUNT,
      );
      expectContained(await auditSrOnly(page), 'released');
    });

    audit.assertClean();
  });
});
