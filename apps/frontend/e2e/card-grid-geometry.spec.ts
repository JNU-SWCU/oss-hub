import { expect, test, type Page } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';

const LONG_KOREAN_TITLE = '가나다라마바사아자차카타파하'.repeat(12);
const RECRUITING_NOW = new Date('2026-06-15T00:00:00.000Z');
const CARDS = '[data-slot="card-grid"] [data-slot="program-card"]';
const COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAAFCAIAAADg0arLAAAAFUlEQVR4nGP4z8DwnwGMQRScgUQBAKx2CfecwJG/AAAAAElFTkSuQmCC',
  'base64',
);

interface Fixture {
  readonly cardCount?: number;
  readonly longTitle?: boolean;
  readonly notes?: 'mixed' | 'all' | 'none';
  readonly image?: 'load' | 'error' | 'none';
  readonly listGate?: Promise<void>;
  readonly imageGate?: Promise<void>;
}

async function installGeometryRoutes(page: Page, spec: Fixture = {}) {
  const items = Array.from({ length: spec.cardCount ?? 6 }, (_, index) => ({
    id: `geometry-program-${index}`,
    name:
      spec.longTitle || index % 3 === 2
        ? LONG_KOREAN_TITLE
        : index % 3 === 0
          ? '합성 캡스톤 2026'
          : '산학 협력 오픈소스 프로그램 합성 캡스톤 디자인 경진대회',
    organizer: '합성 주관',
    trackType: 'CURRICULAR',
    lifecycle: 'PUBLISHED',
    applicationStartAt: '2026-01-01T00:00:00.000Z',
    applicationEndAt: '2026-12-31T00:00:00.000Z',
    endAt: null,
    description: '카드 그리드 기하 UI 전용 합성 항목',
    coverImageUrl:
      spec.image === 'none'
        ? null
        : `/programs/geometry-program-${index}/cover`,
    note:
      spec.notes === 'all' || (spec.notes !== 'none' && index % 2 === 0)
        ? { text: '합성 팀 안내', icon: 'team' }
        : undefined,
  }));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (request.method() === 'GET') {
      if (path === '/api/v1/auth/session') {
        await route.fulfill({ json: { isAuthenticated: false } });
        return;
      }
      if (path === '/api/v1/programs/status-counts') {
        await route.fulfill({
          json: {
            all: items.length,
            recruiting: items.length,
            in_progress: 0,
            upcoming: 0,
            ended: 0,
          },
        });
        return;
      }
      if (/^\/api\/v1\/programs\/geometry-program-\d+\/cover$/.test(path)) {
        await spec.imageGate;
        await route.fulfill({
          status: spec.image === 'error' ? 404 : 200,
          contentType: 'image/png',
          body: spec.image === 'error' ? Buffer.alloc(0) : COVER_PNG,
        });
        return;
      }
      if (path === '/api/v1/programs') {
        if (url.searchParams.get('status') !== 'recruiting') {
          throw new Error(
            `Unexpected GET ${path}${url.search}: status must be recruiting`,
          );
        }
        await spec.listGate;
        await route.fulfill({
          json: {
            items,
            page: 1,
            pageSize: 20,
            totalItems: items.length,
            totalPages: 1,
          },
        });
        return;
      }
    }
    throw new Error(`Unexpected ${request.method()} ${path}${url.search}`);
  });
}

async function openPrograms(page: Page, spec: Fixture = {}, width = 1440) {
  const audit = installBrowserAudit(page);
  await installGeometryRoutes(page, spec);
  await page.setViewportSize({ width, height: 900 });
  await page.clock.setFixedTime(RECRUITING_NOW);
  await page.goto('/programs?status=recruiting');
  await expect(page.locator(CARDS)).toHaveCount(spec.cardCount ?? 6);
  await page.evaluate(() => document.fonts.ready);
  return audit;
}

async function measureCardGrid(
  page: Page,
  containerWidth: number | null = null,
) {
  return page.evaluate((forcedWidth) => {
    const grid = document.querySelector<HTMLElement>('[data-slot="card-grid"]');
    const main = document.querySelector<HTMLElement>('#main-content');
    const input = document.querySelector('[aria-label="프로그램명 검색"]');
    const select = document.querySelector('[aria-label="프로그램 정렬 기준"]');
    const section = grid?.closest('section');
    if (!grid || !main || !input || !select || !section) {
      throw new Error('Missing grid, scrollport, section or filter controls');
    }
    grid.style.width = forcedWidth === null ? '' : `${forcedWidth}px`;
    const rect = (element: Element) => {
      const { left, right, top, bottom, width, height } =
        element.getBoundingClientRect();
      return { left, right, top, bottom, width, height };
    };
    const cards = Array.from(grid.children).map((child) => {
      const card = child.matches('[data-slot="program-card"]')
        ? child
        : (child.querySelector('[data-slot="program-card"]') ?? child);
      const title = card.querySelector('[data-slot="card-title"]');
      const content = card.querySelector('[data-slot="card-content"]');
      const meta = content?.firstElementChild;
      const cover = card.querySelector(
        '[data-slot="program-cover"], .aspect-video',
      );
      const image = cover?.querySelector('img');
      const affordance = card.querySelector(
        '[data-slot="list-card-affordance"]',
      );
      const text = meta?.firstChild;
      const range = document.createRange();
      if (text) range.selectNodeContents(text);
      return {
        ...rect(child),
        title: title ? rect(title) : null,
        lineHeight: title
          ? Number.parseFloat(getComputedStyle(title).lineHeight)
          : 0,
        metaTop: meta ? rect(meta).top : null,
        metaBaseline: text ? (range.getClientRects()[0]?.bottom ?? null) : null,
        affordanceBottom: affordance ? rect(affordance).bottom : null,
        banner: cover ? rect(cover) : null,
        image: image
          ? {
              complete: image.complete,
              naturalWidth: image.naturalWidth,
              fit: getComputedStyle(image).objectFit,
              position: getComputedStyle(image).objectPosition,
            }
          : null,
      };
    });
    const style = getComputedStyle(grid);
    const tracks = style.gridTemplateColumns
      .split(/\s+/)
      .map(Number.parseFloat);
    const gap = Number.parseFloat(style.columnGap);
    const rootFont = Number.parseFloat(
      getComputedStyle(document.documentElement).fontSize,
    );
    const width = rect(grid).width;
    const firstTop = cards[0]?.top;
    return {
      cards,
      tracks,
      gap,
      rootFont,
      trackCapacity: tracks.length,
      expectedCapacity: Math.max(
        1,
        Math.floor((width + gap) / (Math.min(20 * rootFont, width) + gap)),
      ),
      occupiedColumns: new Set(cards.map(({ left }) => Math.round(left))).size,
      firstRow: cards.filter(({ top }) => Math.abs(top - (firstTop ?? 0)) <= 1),
      grid: rect(grid),
      section: rect(section),
      main: rect(main),
      mainClientWidth: main.clientWidth,
      input: rect(input),
      select: rect(select),
      gridOverflow: grid.scrollWidth - grid.clientWidth,
      documentOverflow:
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    };
  }, containerWidth);
}

type Layout = Awaited<ReturnType<typeof measureCardGrid>>;

function assertTracks(result: Layout) {
  expect
    .soft(result.trackCapacity, 'H1 resolved tracks match RAM capacity')
    .toBe(result.expectedCapacity);
  expect
    .soft(
      result.occupiedColumns,
      'H1 occupied columns retain empty auto-fill tracks',
    )
    .toBe(Math.min(result.cards.length, result.trackCapacity));
  for (const card of result.cards) {
    expect
      .soft(
        Math.abs(card.width - result.tracks[0]),
        'H1 card equals full-row track width',
      )
      .toBeLessThanOrEqual(1);
  }
}

function assertNoOverflow(result: Layout) {
  expect
    .soft(result.gridOverflow, 'grid horizontal overflow')
    .toBeLessThanOrEqual(0);
  expect
    .soft(result.documentOverflow, 'document horizontal overflow')
    .toBeLessThanOrEqual(0);
}

async function record(id: string, result: unknown) {
  console.log(`${id} ${JSON.stringify(result)}`);
  await test.info().attach(id, {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
}

const SIDEBAR_STATES = ['expanded', 'collapsed'] as const;

async function collapseSidebar(page: Page) {
  await page
    .getByRole('button', { name: '사이드바 접기', exact: true })
    .click();
  await page.locator('[data-slot="product-shell"]').evaluate(async (shell) => {
    await Promise.all(
      shell.getAnimations().map((animation) => animation.finished),
    );
  });
}

test('G1 H1 full rows align with both filter edges', async ({ page }) => {
  const audit = await openPrograms(page);
  for (const sidebar of SIDEBAR_STATES) {
    if (sidebar === 'collapsed') await collapseSidebar(page);
    const result = await measureCardGrid(page);
    await record(`G1 H1 ${sidebar}`, result);
    assertTracks(result);
    assertNoOverflow(result);
    expect
      .soft(
        Math.abs(result.firstRow[0].left - result.input.left),
        'G1 Input left alignment',
      )
      .toBeLessThanOrEqual(1);
    expect
      .soft(
        Math.abs((result.firstRow.at(-1)?.right ?? 0) - result.select.right),
        'G1 Select right alignment',
      )
      .toBeLessThanOrEqual(1);
  }
  audit.assertClean();
});

for (const count of [1, 2]) {
  test(`H1 empty tracks keep full-row widths with ${count} cards`, async ({
    page,
  }) => {
    const audit = await openPrograms(page);
    const full = await measureCardGrid(page);
    await page.unroute('**/api/v1/**');
    await installGeometryRoutes(page, { cardCount: count });
    await page.reload();
    await expect(page.locator(CARDS)).toHaveCount(count);
    const partial = await measureCardGrid(page);
    await record(`H1 empty ${count}`, { full, partial });
    expect(partial.trackCapacity, 'H1 empty track capacity retained').toBe(
      full.trackCapacity,
    );
    for (const track of partial.tracks) {
      expect
        .soft(
          Math.abs(track - full.tracks[0]),
          'H1 every empty track equals a full-row track',
        )
        .toBeLessThanOrEqual(1);
    }
    audit.assertClean();
  });

  test(`G2 H1 retains empty tracks with ${count} cards`, async ({ page }) => {
    const audit = await openPrograms(page, { cardCount: count });
    const result = await measureCardGrid(page);
    await record('G2 H1', result);
    assertTracks(result);
    assertNoOverflow(result);
    expect(
      Math.abs(result.cards[0].left - result.input.left),
      'G2 Input left alignment',
    ).toBeLessThanOrEqual(1);
    expect(result.trackCapacity, 'G2 empty tracks remain').toBeGreaterThan(
      count,
    );
    audit.assertClean();
  });
}

test('H1 tablet wrap matches available RAM capacity', async ({ page }) => {
  const audit = await openPrograms(page, { cardCount: 3 }, 768);
  const result = await measureCardGrid(page);
  await record('H1 tablet', result);
  assertTracks(result);
  assertNoOverflow(result);
  audit.assertClean();
});

for (const width of [655, 656, 991, 992]) {
  test(`G3 H1 forced grid ${width}px crosses intrinsic thresholds`, async ({
    page,
  }) => {
    const audit = await openPrograms(page);
    if (width === 656 || width === 992) {
      const below = await measureCardGrid(page, width - 1);
      await record(`G3 ${width} lower boundary`, below);
      expect
        .soft(
          below.occupiedColumns,
          'G3 column transition occurs at threshold, not before',
        )
        .toBe(width === 656 ? 1 : 2);
    }
    const result = await measureCardGrid(page, width);
    await record(`G3 ${width}`, result);
    expect(
      Math.abs(result.grid.width - width),
      'G3 forced container width',
    ).toBeLessThanOrEqual(1);
    assertTracks(result);
    assertNoOverflow(result);
    expect
      .soft(result.occupiedColumns, 'G3 threshold columns')
      .toBe(width < 656 ? 1 : width < 992 ? 2 : 3);
    if (width === 991) {
      expect
        .soft(
          Math.abs(result.cards[0].width - 487.5),
          'G3 991px card width 487.5',
        )
        .toBeLessThanOrEqual(1);
    }
    audit.assertClean();
  });
}

for (const containerWidth of [null, 300]) {
  test(`G4 mobile ${containerWidth ?? 'natural'} width fills without overflow`, async ({
    page,
  }) => {
    const audit = await openPrograms(page, {}, 375);
    const result = await measureCardGrid(page, containerWidth);
    await record('G4', result);
    assertNoOverflow(result);
    for (const card of result.cards) {
      expect(
        Math.abs(card.width - result.grid.width),
        'G4 card fills available width',
      ).toBeLessThanOrEqual(1);
    }
    audit.assertClean();
  });
}

test('G5 H1 wide section is centered with at most three columns', async ({
  page,
}) => {
  const audit = await openPrograms(page, {}, 1920);
  const result = await measureCardGrid(page);
  await record('G5 H1', result);
  assertTracks(result);
  expect
    .soft(result.trackCapacity, 'G5 maximum three tracks')
    .toBeLessThanOrEqual(3);
  expect
    .soft(result.grid.width, 'G5 grid inner maximum 1152')
    .toBeLessThanOrEqual(1153);
  const left = result.section.left - result.main.left;
  const right =
    result.main.left + result.mainClientWidth - result.section.right;
  expect
    .soft(Math.abs(left - right), 'G5 centered within main client width')
    .toBeLessThanOrEqual(1);
  audit.assertClean();
});

test('G6 long Korean title stays within two lines at 320px', async ({
  page,
}) => {
  const audit = await openPrograms(page, { longTitle: true }, 375);
  const result = await measureCardGrid(page, 320);
  await record('G6', result);
  assertNoOverflow(result);
  for (const card of result.cards) {
    expect
      .soft(card.title?.height, 'G6 title maximum two line heights')
      .toBeLessThanOrEqual(2 * card.lineHeight + 1);
    expect
      .soft(card.title?.right, 'G6 title stays inside card')
      .toBeLessThanOrEqual(card.right + 1);
  }
  audit.assertClean();
});

test('AC5 first row fits the scrollport with complete compact cards', async ({
  page,
}) => {
  const audit = await openPrograms(page);
  for (const sidebar of SIDEBAR_STATES) {
    if (sidebar === 'collapsed') await collapseSidebar(page);
    const result = await measureCardGrid(page);
    await record(`AC5 ${sidebar}`, result);
    expect(
      result.firstRow.length,
      `AC5 ${sidebar} first row holds three cards`,
    ).toBeGreaterThanOrEqual(3);
    for (const card of result.cards) {
      expect
        .soft(
          card.height,
          `AC5 ${sidebar} card height maximum 400px plus rounding`,
        )
        .toBeLessThanOrEqual(401);
    }
    for (const card of result.firstRow) {
      expect
        .soft(card.bottom, `AC5 ${sidebar} first row fully visible`)
        .toBeLessThanOrEqual(result.main.bottom + 1);
    }
  }
  audit.assertClean();
});

async function decodeImages(page: Page) {
  await page.locator(`${CARDS} img`).evaluateAll(async (images) => {
    await Promise.all(
      images.map(async (image) => {
        if (image instanceof HTMLImageElement) await image.decode();
      }),
    );
  });
}

for (const state of ['load', 'error', 'none'] as const) {
  test(`AC6 ${state} keeps 16:9 banner geometry before and after image settlement`, async ({
    page,
  }) => {
    const image = Promise.withResolvers<void>();
    const audit = await openPrograms(page, {
      cardCount: 3,
      image: 'load',
      imageGate: image.promise,
    });
    const before = await measureCardGrid(page);
    image.resolve();
    await decodeImages(page);
    const loaded = await measureCardGrid(page);
    let after = loaded;
    if (state !== 'load') {
      await page.unroute('**/api/v1/**');
      await installGeometryRoutes(page, { cardCount: 3, image: state });
      await page.reload();
      await expect(page.locator(CARDS)).toHaveCount(3);
      await expect(
        page.locator(
          `[data-cover-state="${state === 'error' ? 'error' : 'empty'}"]`,
        ),
      ).toHaveCount(3);
      await page.evaluate(() => document.fonts.ready);
      after = await measureCardGrid(page);
    }
    await record(`AC6 ${state}`, { before, loaded, after });
    const comparisons =
      state === 'load'
        ? [['before load', before] as const]
        : [['before load', before] as const, [state, after] as const];
    for (const [index, card] of after.cards.entries()) {
      expect.soft(card.banner, 'AC6 banner exists').not.toBeNull();
      if (!card.banner) continue;
      expect
        .soft(
          Math.abs(card.banner.width / card.banner.height - 16 / 9),
          'AC6 16:9 ratio',
        )
        .toBeLessThanOrEqual(0.02);
      for (const [label, snapshot] of comparisons) {
        const reference = loaded.cards[index];
        const measured = snapshot.cards[index];
        expect
          .soft(measured.banner, `AC6 ${label} banner exists`)
          .not.toBeNull();
        expect
          .soft(reference.banner, 'AC6 loaded reference banner exists')
          .not.toBeNull();
        for (const key of [
          'left',
          'right',
          'top',
          'bottom',
          'width',
          'height',
        ] as const) {
          expect
            .soft(
              Math.abs(
                (measured.banner?.[key] ?? 0) - (reference.banner?.[key] ?? 0),
              ),
              `AC6 ${label} vs loaded banner ${key}`,
            )
            .toBeLessThanOrEqual(1);
          expect
            .soft(
              Math.abs(measured[key] - reference[key]),
              `AC6 ${label} vs loaded card ${key}`,
            )
            .toBeLessThanOrEqual(1);
        }
      }
      if (state === 'load') {
        expect.soft(card.image?.complete, 'AC6 loaded PNG complete').toBe(true);
        expect
          .soft(card.image?.naturalWidth, 'AC6 PNG decoded')
          .toBeGreaterThan(0);
        expect.soft(card.image?.fit, 'AC6 top crop fit').toBe('cover');
        expect
          .soft(card.image?.position, 'AC6 top crop position')
          .toBe('50% 0%');
      }
    }
    audit.assertClean(
      state === 'error'
        ? [0, 1, 2].map((index) => ({
            status: 404,
            path: `/api/v1/programs/geometry-program-${index}/cover`,
          }))
        : [],
    );
  });
}

test('AC7 mixed title and note rows align metadata and affordance baselines', async ({
  page,
}) => {
  const audit = await openPrograms(page);
  const result = await measureCardGrid(page);
  await record('AC7', result);
  const first = result.firstRow[0];
  for (const card of result.firstRow) {
    expect
      .soft(card.title?.height, 'AC7 two-line title clamp')
      .toBeLessThanOrEqual(2 * card.lineHeight + 1);
    expect.soft(card.metaTop, 'AC7 metadata exists').not.toBeNull();
    expect
      .soft(
        Math.abs((card.metaTop ?? 0) - (first.metaTop ?? 0)),
        'AC7 metadata tops align',
      )
      .toBeLessThanOrEqual(1);
    expect
      .soft(
        Math.abs((card.metaBaseline ?? 0) - (first.metaBaseline ?? 0)),
        'AC7 text baselines align',
      )
      .toBeLessThanOrEqual(1);
    expect
      .soft(
        Math.abs((card.affordanceBottom ?? 0) - (first.affordanceBottom ?? 0)),
        'AC7 affordance bottoms align',
      )
      .toBeLessThanOrEqual(1);
  }
  audit.assertClean();
});

async function settleFrames(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

for (const notes of ['all', 'none'] as const) {
  test(`AC8 skeleton matches ready first row with ${notes} notes`, async ({
    page,
  }) => {
    const list = Promise.withResolvers<void>();
    const image = Promise.withResolvers<void>();
    const audit = installBrowserAudit(page);
    await installGeometryRoutes(page, {
      cardCount: 3,
      notes,
      listGate: list.promise,
      imageGate: image.promise,
    });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.clock.setFixedTime(RECRUITING_NOW);
    await page.goto('/programs?status=recruiting');
    await expect(
      page.locator('[data-slot="skeleton"] [data-slot="card-grid"] > *'),
    ).toHaveCount(3);
    await settleFrames(page);
    const before = await measureCardGrid(page);
    list.resolve();
    await expect(page.locator(CARDS)).toHaveCount(3);
    image.resolve();
    await decodeImages(page);
    await settleFrames(page);
    const after = await measureCardGrid(page);
    await record(`AC8 ${notes}`, { before, after });
    const maxHeight = Math.max(...after.firstRow.map(({ height }) => height));
    for (const [index, skeleton] of before.firstRow.entries()) {
      const ready = after.firstRow[index];
      expect
        .soft(
          Math.abs(skeleton.width - ready.width),
          'AC8 skeleton width equals ready',
        )
        .toBeLessThanOrEqual(1);
      expect
        .soft(skeleton.banner, 'AC8 skeleton reserves banner')
        .not.toBeNull();
      expect
        .soft(
          Math.abs(
            (skeleton.banner?.height ?? 0) - (ready.banner?.height ?? 0),
          ),
          'AC8 skeleton banner height equals ready',
        )
        .toBeLessThanOrEqual(1);
      expect
        .soft(
          Math.abs(skeleton.height - maxHeight),
          'AC8 skeleton height equals ready maximum',
        )
        .toBeLessThanOrEqual(2);
      expect
        .soft(Math.abs(skeleton.top - ready.top), 'AC8 first-row displacement')
        .toBeLessThanOrEqual(1);
    }
    audit.assertClean();
  });
}

interface Shift {
  readonly value: number;
  readonly hadRecentInput: boolean;
  readonly startTime: number;
  readonly sources: readonly string[];
}

interface ShiftPerformanceEntry extends PerformanceEntry {
  readonly value: number;
  readonly hadRecentInput: boolean;
  readonly sources: readonly { readonly node?: Node }[];
}

declare global {
  interface Window {
    __ls: Shift[];
  }
}

test('AC6 CLS zero across held skeleton list and deferred PNG load', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.__ls = [];
    new PerformanceObserver((list) => {
      for (const entry of list
        .getEntries()
        .filter(
          (value): value is ShiftPerformanceEntry =>
            value.entryType === 'layout-shift',
        )) {
        window.__ls.push({
          value: entry.value,
          hadRecentInput: entry.hadRecentInput,
          startTime: entry.startTime,
          sources: entry.sources.map(({ node }) => {
            const element =
              node instanceof Element ? node : node?.parentElement;
            if (!element) return 'unattributed';
            if (element.closest('nextjs-portal')) return 'nextjs-portal';
            if (element.closest('[data-slot="card-grid"]'))
              return '[data-slot="card-grid"]';
            if (
              element
                .closest('section')
                ?.querySelector('[aria-label="프로그램명 검색"]')
            )
              return 'programs-section';
            return (
              element.tagName.toLowerCase() +
              (element.id ? `#${element.id}` : '')
            );
          }),
        });
      }
    }).observe({ type: 'layout-shift', buffered: true });
  });
  const list = Promise.withResolvers<void>();
  const image = Promise.withResolvers<void>();
  const audit = installBrowserAudit(page);
  await installGeometryRoutes(page, {
    cardCount: 3,
    listGate: list.promise,
    imageGate: image.promise,
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.clock.setFixedTime(RECRUITING_NOW);
  await page.goto('/programs?status=recruiting');
  expect(
    await page.evaluate(() =>
      PerformanceObserver.supportedEntryTypes.includes('layout-shift'),
    ),
    'CLS browser supports layout-shift observation',
  ).toBe(true);
  await expect(page.locator('[data-slot="skeleton"]')).toBeVisible();
  await settleFrames(page);
  const baseline = await page.evaluate(() => ({
    t0: performance.now(),
    count: window.__ls.length,
  }));
  list.resolve();
  await expect(page.locator(CARDS)).toHaveCount(3);
  image.resolve();
  await decodeImages(page);
  await settleFrames(page);
  const result = await page.evaluate(({ t0, count }) => {
    const t1 = performance.now();
    const entries = window.__ls
      .slice(count)
      .filter(
        (entry) =>
          entry.startTime >= t0 &&
          entry.startTime <= t1 &&
          !entry.hadRecentInput,
      );
    const excluded = entries.filter(
      (entry) =>
        entry.sources.length > 0 &&
        entry.sources.every((source) => source === 'nextjs-portal'),
    );
    const attributable = entries.filter((entry) => !excluded.includes(entry));
    return {
      t0,
      t1,
      baselineCount: count,
      interval: t1 - t0,
      excluded,
      attributable,
      sum: attributable.reduce((sum, entry) => sum + entry.value, 0),
      count: attributable.length,
    };
  }, baseline);
  await record('AC6 CLS', result);
  expect(result.sum, 'CLS layout shift sum must be exactly zero').toBe(0);
  expect(
    result.count,
    'CLS layout shift entry count must be exactly zero',
  ).toBe(0);
  audit.assertClean();
});
