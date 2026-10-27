import { expect, test, type Page } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';

const LONG_KOREAN_TITLE = '가나다라마바사아자차카타파하'.repeat(12);
const RECRUITING_NOW = new Date('2026-06-15T00:00:00.000Z');
const CARDS = '[data-slot="card-grid"] [data-slot="program-card"]';
const TRACK_REM = 20;
const POSTER_WIDTH = 88;
const POSTER_RATIO = 1.414;
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
  return page.evaluate(
    ({ forcedWidth, trackRem }) => {
      const grid = document.querySelector<HTMLElement>(
        '[data-slot="card-grid"]',
      );
      const main = document.querySelector<HTMLElement>('#main-content');
      const input = document.querySelector('[aria-label="프로그램명 검색"]');
      const select = document.querySelector(
        '[aria-label="프로그램 정렬 기준"]',
      );
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
        const poster = card.querySelector('[data-slot="list-card-cover"] > *');
        const image = poster?.querySelector('img');
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
          metaBaseline: text
            ? (range.getClientRects()[0]?.bottom ?? null)
            : null,
          affordanceBottom: affordance ? rect(affordance).bottom : null,
          poster: poster ? rect(poster) : null,
          image: image
            ? {
                complete: image.complete,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
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
      const rowTops = cards
        .map(({ top }) => top)
        .filter(
          (top, index, tops) =>
            tops.findIndex((other) => Math.abs(other - top) <= 1) === index,
        )
        .sort((first, second) => first - second);
      return {
        cards,
        tracks,
        gap,
        rootFont,
        trackCapacity: tracks.length,
        expectedCapacity: Math.max(
          1,
          Math.floor(
            (width + gap) / (Math.min(trackRem * rootFont, width) + gap),
          ),
        ),
        occupiedColumns: new Set(cards.map(({ left }) => Math.round(left)))
          .size,
        rows: rowTops.map((rowTop) =>
          cards.filter(({ top }) => Math.abs(top - rowTop) <= 1),
        ),
        firstRow: cards.filter(
          ({ top }) => Math.abs(top - (rowTops[0] ?? 0)) <= 1,
        ),
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
    },
    { forcedWidth: containerWidth, trackRem: TRACK_REM },
  );
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

function assertPosterRatio(result: Layout, label: string) {
  for (const card of result.cards) {
    expect.soft(card.poster, `${label} poster exists`).not.toBeNull();
    if (!card.poster) continue;
    expect
      .soft(
        Math.abs(card.poster.width - POSTER_WIDTH),
        `${label} poster column width`,
      )
      .toBeLessThanOrEqual(1);
    expect
      .soft(
        Math.abs(card.poster.height / card.poster.width - POSTER_RATIO),
        `${label} A4 poster ratio`,
      )
      .toBeLessThanOrEqual(0.02);
  }
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
    expect
      .soft(partial.occupiedColumns, 'H1 occupied columns equal item count')
      .toBe(Math.min(count, partial.trackCapacity));
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
}

test('G2 H1 retains an empty track with a single card', async ({ page }) => {
  const audit = await openPrograms(page, { cardCount: 1 });
  const result = await measureCardGrid(page);
  await record('G2 H1', result);
  assertTracks(result);
  assertNoOverflow(result);
  expect(
    Math.abs(result.cards[0].left - result.input.left),
    'G2 Input left alignment',
  ).toBeLessThanOrEqual(1);
  expect(result.trackCapacity, 'G2 empty track remains').toBeGreaterThan(1);
  audit.assertClean();
});

test('H1 tablet wrap matches available RAM capacity', async ({ page }) => {
  const audit = await openPrograms(page, { cardCount: 3 }, 768);
  const result = await measureCardGrid(page);
  await record('H1 tablet', result);
  assertTracks(result);
  assertNoOverflow(result);
  audit.assertClean();
});

for (const [width, columns] of [
  [655, 1],
  [656, 2],
  [991, 2],
  [992, 3],
  [1152, 3],
] as const) {
  test(`G3 H1 forced grid ${width}px resolves to ${columns} columns`, async ({
    page,
  }) => {
    const audit = await openPrograms(page, {}, 1920);
    const result = await measureCardGrid(page, width);
    await record(`G3 ${width}`, result);
    expect(
      Math.abs(result.grid.width - width),
      'G3 forced container width',
    ).toBeLessThanOrEqual(1);
    assertTracks(result);
    assertNoOverflow(result);
    expect.soft(result.trackCapacity, 'G3 threshold tracks').toBe(columns);
    expect.soft(result.occupiedColumns, 'G3 threshold columns').toBe(columns);
    for (const card of result.cards) {
      expect
        .soft(
          Math.abs(card.width - (width - result.gap * (columns - 1)) / columns),
          'G3 card width splits the forced width evenly',
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
    assertPosterRatio(result, 'G4');
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

test('AC5 two full rows of compact cards fit the scrollport', async ({
  page,
}) => {
  const audit = await openPrograms(page);
  for (const sidebar of SIDEBAR_STATES) {
    if (sidebar === 'collapsed') await collapseSidebar(page);
    const result = await measureCardGrid(page);
    await record(`AC5 ${sidebar}`, result);
    expect(
      result.rows.length,
      `AC5 ${sidebar} at least two rows`,
    ).toBeGreaterThanOrEqual(2);
    for (const card of result.cards) {
      expect
        .soft(card.height, `AC5 ${sidebar} card height maximum 190px`)
        .toBeLessThanOrEqual(190);
    }
    for (const card of result.rows.slice(0, 2).flat()) {
      expect
        .soft(card.bottom, `AC5 ${sidebar} first two rows fully visible`)
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
  test(`AC6 ${state} keeps A4 poster geometry before and after image settlement`, async ({
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
    assertPosterRatio(before, 'AC6 before load');
    assertPosterRatio(loaded, 'AC6 loaded');
    assertPosterRatio(after, `AC6 ${state}`);
    const comparisons =
      state === 'load'
        ? [['before load', before] as const]
        : [['before load', before] as const, [state, after] as const];
    for (const [index, card] of after.cards.entries()) {
      for (const [label, snapshot] of comparisons) {
        const reference = loaded.cards[index];
        const measured = snapshot.cards[index];
        expect
          .soft(measured.poster, `AC6 ${label} poster exists`)
          .not.toBeNull();
        expect
          .soft(reference.poster, 'AC6 loaded reference poster exists')
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
                (measured.poster?.[key] ?? 0) - (reference.poster?.[key] ?? 0),
              ),
              `AC6 ${label} vs loaded poster ${key}`,
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
          .soft(card.image?.naturalWidth, 'AC6 PNG decoded width')
          .toBeGreaterThan(0);
        expect
          .soft(card.image?.naturalHeight, 'AC6 PNG decoded height')
          .toBeGreaterThan(0);
        expect.soft(card.image?.fit, 'AC6 uncropped fit').toBe('contain');
        expect
          .soft(card.image?.position, 'AC6 centered position')
          .toBe('50% 50%');
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

test('AC7 mixed title and note rows align card edges, metadata and affordance baselines', async ({
  page,
}) => {
  const audit = await openPrograms(page);
  const result = await measureCardGrid(page);
  await record('AC7', result);
  for (const row of result.rows) {
    const first = row[0];
    for (const card of row) {
      expect
        .soft(card.title?.height, 'AC7 two-line title clamp')
        .toBeLessThanOrEqual(2 * card.lineHeight + 1);
      expect
        .soft(Math.abs(card.top - first.top), 'AC7 card tops align')
        .toBeLessThanOrEqual(1);
      expect
        .soft(Math.abs(card.bottom - first.bottom), 'AC7 card bottoms align')
        .toBeLessThanOrEqual(1);
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
          Math.abs(
            (card.affordanceBottom ?? 0) - (first.affordanceBottom ?? 0),
          ),
          'AC7 affordance bottoms align',
        )
        .toBeLessThanOrEqual(1);
    }
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
    ).toHaveCount(6);
    await settleFrames(page);
    const before = await measureCardGrid(page);
    list.resolve();
    await expect(page.locator(CARDS)).toHaveCount(3);
    image.resolve();
    await decodeImages(page);
    await settleFrames(page);
    const after = await measureCardGrid(page);
    await record(`AC8 ${notes}`, { before, after });
    assertPosterRatio(before, 'AC8 skeleton');
    expect(before.firstRow.length, 'AC8 skeleton first row is full').toBe(
      before.trackCapacity,
    );
    for (const [index, skeleton] of before.firstRow.entries()) {
      const ready = after.firstRow[index];
      for (const key of ['width', 'height', 'top', 'left'] as const) {
        expect
          .soft(
            Math.abs(skeleton[key] - ready[key]),
            `AC8 skeleton card ${key} equals ready`,
          )
          .toBeLessThanOrEqual(1);
      }
      expect
        .soft(skeleton.poster, 'AC8 skeleton reserves the poster')
        .not.toBeNull();
      for (const key of ['width', 'height', 'top', 'left'] as const) {
        expect
          .soft(
            Math.abs(
              (skeleton.poster?.[key] ?? 0) - (ready.poster?.[key] ?? 0),
            ),
            `AC8 skeleton poster ${key} equals ready`,
          )
          .toBeLessThanOrEqual(1);
      }
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
