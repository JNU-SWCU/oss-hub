import { expect, test, type Page } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';

/**
 * 카드 그리드 레이아웃만 본다. 가로채기 응답은 화면을 그리기 위한 UI 전용
 * 합성 데이터이며 백엔드 정확성·인가 증거가 아니다.
 *
 * 독립 한계: 18rem(288px)·22rem(352px) ±0.5px, 1px 정렬/트랙 허용, 가로
 * 스크롤 없음, 320px 강제 폭, 긴 한글 제목이 카드 안에 머무름.
 */

const FIXTURE_TITLE = '합성 캡스톤 2026';
const LONG_KOREAN_TITLE = '가나다라마바사아자차카타파하'.repeat(12);
const BOUNDED_CARD_MIN_PX = 287.5;
const BOUNDED_CARD_MAX_PX = 352.5;
const LAYOUT_TOLERANCE_PX = 1;
/** 신청 기간(2026-01-01–2026-12-31) 안의 고정 Date. 타이머는 그대로 흐른다. */
const RECRUITING_NOW = new Date('2026-06-15T00:00:00.000Z');

type GeometryMode = 'bounded' | 'available' | 'long-title';

interface GeometryCase {
  readonly name: string;
  readonly title: string;
  readonly width: number;
  readonly height: number;
  readonly cardCount: number;
  readonly firstRowCount: number;
  readonly containerWidth: number | null;
  readonly mode: GeometryMode;
}

const CASES: readonly GeometryCase[] = [
  {
    name: 'desktop-singleton',
    title: '데스크톱에서 카드 한 장의 너비가 18–22rem 안에 있다',
    width: 1440,
    height: 900,
    cardCount: 1,
    firstRowCount: 1,
    containerWidth: null,
    mode: 'bounded',
  },
  {
    name: 'desktop-two-cards',
    title: '데스크톱에서 카드 두 장이 같은 줄에서 같은 너비로 맞는다',
    width: 1440,
    height: 900,
    cardCount: 2,
    firstRowCount: 2,
    containerWidth: null,
    mode: 'bounded',
  },
  {
    name: 'tablet-wrap',
    title: '768폭에서 세 장이 두 열로 접히고 가로로 넘치지 않는다',
    width: 768,
    height: 900,
    cardCount: 3,
    firstRowCount: 2,
    containerWidth: null,
    mode: 'bounded',
  },
  {
    name: 'mobile',
    title: '375폭에서 카드가 그리드 너비를 채우고 가로 스크롤이 없다',
    width: 375,
    height: 812,
    cardCount: 3,
    firstRowCount: 1,
    containerWidth: null,
    mode: 'available',
  },
  {
    name: 'container-320-long-korean',
    title: '320폭 그리드에서 긴 한글 제목이 카드 안에 머문다',
    width: 375,
    height: 812,
    cardCount: 3,
    firstRowCount: 1,
    containerWidth: 320,
    mode: 'long-title',
  },
];

interface MeasuredLayout {
  readonly kind: 'measured';
  readonly widths: readonly number[];
  readonly cardLeft: number | null;
  readonly firstRowCount: number;
  readonly gridClientWidth: number;
  readonly gridLeft: number;
  readonly gridScrollWidth: number;
  readonly gridWidth: number;
  readonly documentClientWidth: number;
  readonly documentScrollWidth: number;
  readonly titleClientWidth: number | null;
  readonly titleLeft: number | null;
  readonly titleRight: number | null;
  readonly titleScrollWidth: number | null;
  readonly tracks: readonly number[];
}

type MeasureResult =
  | MeasuredLayout
  | { readonly kind: 'missing-grid' }
  | { readonly kind: 'missing-title' };

interface VisibleMeasuredLayout extends MeasuredLayout {
  readonly cardLeft: number;
}

function programItem(index: number, name: string) {
  return {
    id: `geometry-program-${index}`,
    name,
    organizer: '합성 주관',
    trackType: 'CURRICULAR',
    lifecycle: 'PUBLISHED',
    applicationStartAt: '2026-01-01T00:00:00.000Z',
    applicationEndAt: '2026-12-31T00:00:00.000Z',
    endAt: null,
    description: '카드 그리드 기하 UI 전용 합성 항목',
  };
}

function programName(spec: GeometryCase, index: number): string {
  if (index === 0) {
    return spec.mode === 'long-title' ? LONG_KOREAN_TITLE : FIXTURE_TITLE;
  }
  return `${FIXTURE_TITLE}-${index + 1}`;
}

async function installGeometryRoutes(
  page: Page,
  spec: GeometryCase,
): Promise<void> {
  const items = Array.from({ length: spec.cardCount }, (_, index) =>
    programItem(index, programName(spec, index)),
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
      if (url.searchParams.get('status') !== 'recruiting') {
        throw new Error(
          `Unexpected ${method} ${path}${url.search}: status must be recruiting`,
        );
      }
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

    throw new Error(`Unexpected ${method} ${path}${url.search}`);
  });
}

function assertVisibleMeasuredLayout(
  name: string,
  result: MeasureResult,
): asserts result is VisibleMeasuredLayout {
  if (result.kind !== 'measured') {
    throw new Error(`${name}: ${result.kind}`);
  }
  if (result.cardLeft === null || result.widths[0] === undefined) {
    throw new Error(`${name}: visible card missing`);
  }
}

async function measureCardGrid(
  page: Page,
  spec: GeometryCase,
): Promise<VisibleMeasuredLayout> {
  const result = await page.evaluate(
    ({ containerWidth, longTitleValue }): MeasureResult => {
      const grid = document.querySelector('[data-slot="card-grid"]');
      if (!(grid instanceof HTMLElement)) return { kind: 'missing-grid' };
      grid.style.width = containerWidth === null ? '' : `${containerWidth}px`;
      const children = Array.from(grid.children);
      let title: HTMLElement | undefined;
      if (longTitleValue !== null) {
        const card = grid.querySelector('[data-slot="program-card"]');
        title = Array.from(card?.querySelectorAll('div') ?? []).find(
          (element) => element.textContent?.includes(longTitleValue),
        );
        if (!(title instanceof HTMLElement)) return { kind: 'missing-title' };
      }
      const rectangles = children.map((element) =>
        element.getBoundingClientRect(),
      );
      const gridRectangle = grid.getBoundingClientRect();
      const firstTop = Math.min(...rectangles.map(({ top }) => top));
      return {
        kind: 'measured',
        widths: rectangles.map(({ width: cardWidth }) => cardWidth),
        cardLeft: rectangles[0]?.left ?? null,
        firstRowCount: rectangles.filter(
          ({ top }) => Math.abs(top - firstTop) <= 1,
        ).length,
        gridClientWidth: grid.clientWidth,
        gridLeft: gridRectangle.left,
        gridScrollWidth: grid.scrollWidth,
        gridWidth: gridRectangle.width,
        documentClientWidth: document.documentElement.clientWidth,
        documentScrollWidth: document.documentElement.scrollWidth,
        titleClientWidth: title?.clientWidth ?? null,
        titleLeft: title?.getBoundingClientRect().left ?? null,
        titleRight: title?.getBoundingClientRect().right ?? null,
        titleScrollWidth: title?.scrollWidth ?? null,
        tracks: getComputedStyle(grid)
          .gridTemplateColumns.split(/\s+/)
          .map(Number.parseFloat),
      };
    },
    {
      containerWidth: spec.containerWidth,
      longTitleValue: spec.mode === 'long-title' ? LONG_KOREAN_TITLE : null,
    },
  );

  assertVisibleMeasuredLayout(spec.name, result);
  return result;
}

test.describe('카드 그리드 기하 (UI 전용)', () => {
  for (const spec of CASES) {
    test(`${spec.name}: ${spec.title}`, async ({ page }, testInfo) => {
      const audit = installBrowserAudit(page);
      await installGeometryRoutes(page, spec);
      await page.setViewportSize({ width: spec.width, height: spec.height });
      await page.clock.setFixedTime(RECRUITING_NOW);
      await page.goto('/programs?status=recruiting');

      const expectedTitle =
        spec.mode === 'long-title' ? LONG_KOREAN_TITLE : FIXTURE_TITLE;
      await expect(
        page.getByRole('heading', { name: '모집중인 프로그램' }),
      ).toBeVisible();
      await expect(page.locator('[data-slot="program-card"]')).toHaveCount(
        spec.cardCount,
      );
      await expect(
        page
          .locator('[data-slot="program-card"]')
          .filter({ hasText: expectedTitle })
          .first(),
      ).toBeVisible();

      const result = await measureCardGrid(page, spec);
      const firstWidth = result.widths[0];

      expect(result.widths, 'visible card count').toHaveLength(spec.cardCount);
      expect(result.firstRowCount, 'first-row card count').toBe(
        spec.firstRowCount,
      );
      for (const cardWidth of result.widths) {
        expect(
          Math.abs(cardWidth - firstWidth),
          'equal card widths',
        ).toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);
      }
      result.widths.slice(0, spec.firstRowCount).forEach((cardWidth, index) => {
        const track = result.tracks[index];
        expect(Number.isFinite(track), `track ${index} is finite`).toBe(true);
        if (track === undefined) {
          throw new Error(`${spec.name}: missing track ${index}`);
        }
        expect(
          Math.abs(cardWidth - track),
          `card ${index} matches track`,
        ).toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);
      });
      expect(
        Math.abs(result.cardLeft - result.gridLeft),
        'first card aligns to grid',
      ).toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);

      if (spec.mode === 'bounded') {
        for (const cardWidth of result.widths) {
          expect(cardWidth).toBeGreaterThanOrEqual(BOUNDED_CARD_MIN_PX);
          expect(cardWidth).toBeLessThanOrEqual(BOUNDED_CARD_MAX_PX);
        }
      } else {
        for (const cardWidth of result.widths) {
          expect(
            Math.abs(cardWidth - result.gridWidth),
            'card fills grid width',
          ).toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);
        }
      }

      expect(
        result.gridScrollWidth,
        'grid does not overflow horizontally',
      ).toBeLessThanOrEqual(result.gridClientWidth);
      expect(
        result.documentScrollWidth,
        'document does not overflow horizontally',
      ).toBeLessThanOrEqual(result.documentClientWidth);

      if (spec.containerWidth !== null) {
        expect(
          Math.abs(result.gridWidth - spec.containerWidth),
          'forced container width',
        ).toBeLessThanOrEqual(LAYOUT_TOLERANCE_PX);
      }

      if (spec.mode === 'long-title') {
        if (
          result.titleClientWidth === null ||
          result.titleLeft === null ||
          result.titleRight === null ||
          result.titleScrollWidth === null
        ) {
          throw new Error(`${spec.name}: missing title metrics`);
        }
        expect(result.titleClientWidth).toBe(result.titleScrollWidth);
        expect(result.titleLeft).toBeGreaterThanOrEqual(result.cardLeft);
        expect(result.titleRight).toBeLessThanOrEqual(
          result.cardLeft + firstWidth + LAYOUT_TOLERANCE_PX,
        );
      }

      audit.assertClean();

      await testInfo.attach(`${spec.name}-geometry`, {
        body: JSON.stringify(
          {
            claim: 'layout-only',
            viewport: { width: spec.width, height: spec.height },
            ...result,
          },
          null,
          2,
        ),
        contentType: 'application/json',
      });

      await page.addStyleTag({
        content: 'nextjs-portal { display: none !important; }',
      });
      const imagePath = testInfo.outputPath(`${spec.name}.png`);
      const image = await page.screenshot({
        path: imagePath,
        fullPage: true,
      });
      expect(new Set(image).size).toBeGreaterThan(32);
      await testInfo.attach(spec.name, {
        path: imagePath,
        contentType: 'image/png',
      });
    });
  }
});
