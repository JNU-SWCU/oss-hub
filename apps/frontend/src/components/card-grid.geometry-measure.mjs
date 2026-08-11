import { GeometryRunnerError, within } from './card-grid.geometry-runtime.mjs';

const fixtureTitle = '합성 캡스톤 2026';
const longKoreanTitle = '가나다라마바사아자차카타파하'.repeat(12);
const cases = [
  ['desktop-singleton', 1440, 900, 1, 1, 1, null, 'bounded'],
  ['desktop-two-cards', 1440, 900, 2, 2, 2, null, 'bounded'],
  ['tablet-wrap', 768, 900, null, 3, 2, null, 'bounded'],
  ['mobile', 375, 812, null, 3, 1, null, 'available'],
  ['container-320-long-korean', 375, 812, null, 3, 1, 320, 'long-title'],
];

function assertCase(name, checks, result) {
  for (const [check, passed] of Object.entries(checks)) {
    if (!passed) {
      throw new GeometryRunnerError(
        name,
        `${check} failed; result=${JSON.stringify(result)}`,
      );
    }
  }
}

async function measure(page, specification, workDeadline) {
  const [
    name,
    width,
    height,
    visibleCount,
    expectedCount,
    firstRowCount,
    containerWidth,
    mode,
  ] = specification;
  await within(
    page.setViewportSize({ width, height }),
    workDeadline,
    `${name}-viewport`,
  );
  const result = await within(
    page.evaluate(
      ({
        containerWidth,
        longTitle,
        longTitleValue,
        originalTitle,
        visibleCount,
      }) => {
        const grid = document.querySelector('[data-slot="card-grid"]');
        if (!(grid instanceof HTMLElement)) return { kind: 'missing-grid' };
        grid.style.width = containerWidth === null ? '' : `${containerWidth}px`;
        const children = Array.from(grid.children);
        children.forEach((element, index) => {
          if (element instanceof HTMLElement) {
            element.hidden =
              visibleCount === null ? false : index >= visibleCount;
          }
        });
        let title;
        if (longTitle) {
          const card = grid.querySelector('[data-slot="program-card"]');
          title = Array.from(card?.querySelectorAll('div') ?? []).find(
            (element) => element.textContent?.includes(originalTitle),
          );
          const text = Array.from(title?.childNodes ?? []).find(
            (node) =>
              node.nodeType === Node.TEXT_NODE &&
              node.textContent === originalTitle,
          );
          if (!(title instanceof HTMLElement) || text === undefined) {
            return { kind: 'missing-title' };
          }
          text.textContent = longTitleValue;
        }
        const rectangles = children
          .filter((element) => !element.hasAttribute('hidden'))
          .map((element) => element.getBoundingClientRect());
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
        containerWidth,
        longTitle: mode === 'long-title',
        longTitleValue: longKoreanTitle,
        originalTitle: fixtureTitle,
        visibleCount,
      },
    ),
    workDeadline,
    name,
  );
  if (result.kind !== 'measured')
    throw new GeometryRunnerError(name, result.kind);
  const firstWidth = result.widths[0];
  if (firstWidth === undefined || result.cardLeft === null) {
    throw new GeometryRunnerError(name, 'visible card missing');
  }
  const checks = {
    count: result.widths.length === expectedCount,
    rows: result.firstRowCount === firstRowCount,
    equal: result.widths.every(
      (cardWidth) => Math.abs(cardWidth - firstWidth) <= 1,
    ),
    tracks: result.widths.slice(0, firstRowCount).every((cardWidth, index) => {
      const track = result.tracks[index];
      return Number.isFinite(track) && Math.abs(cardWidth - track) <= 1;
    }),
    aligned: Math.abs(result.cardLeft - result.gridLeft) <= 1,
    width:
      mode === 'bounded'
        ? result.widths.every(
            (cardWidth) => cardWidth >= 287.5 && cardWidth <= 352.5,
          )
        : result.widths.every(
            (cardWidth) => Math.abs(cardWidth - result.gridWidth) <= 1,
          ),
    gridContained: result.gridScrollWidth <= result.gridClientWidth,
    documentContained: result.documentScrollWidth <= result.documentClientWidth,
    forcedWidth:
      containerWidth === null ||
      Math.abs(result.gridWidth - containerWidth) <= 1,
    titleContained:
      mode !== 'long-title' ||
      (result.titleClientWidth !== null &&
        result.titleClientWidth === result.titleScrollWidth &&
        result.titleLeft !== null &&
        result.titleRight !== null &&
        result.titleLeft >= result.cardLeft &&
        result.titleRight <= result.cardLeft + firstWidth + 1),
  };
  assertCase(name, checks, result);
  return { name, viewport: { width, height }, ...result };
}

export { cases, fixtureTitle, measure };
