import { expect, type Page } from '@playwright/test';

export const PROGRAM_TICK_SELECTOR = '.recharts-cartesian-axis-tick-value';
const denseProgramCount = 12;

interface TickBounds {
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export async function hideNextDevTools(page: Page): Promise<void> {
  const trigger = page.locator('[data-nextjs-dev-tools-button]');
  if (!(await trigger.isVisible())) return;
  await trigger.click();
  await page.locator('[data-preferences]').click();
  await page.locator('[data-hide-dev-tools]').click();
  await expect(trigger).toBeHidden();
}

export async function expectProgramChartLayout(page: Page): Promise<void> {
  const ticks = page.locator(PROGRAM_TICK_SELECTOR).filter({
    hasText: '프로그램',
  });
  await expect(ticks).toHaveCount(denseProgramCount);
  const result = await ticks.evaluateAll((elements) => {
    const visibleText = (element: Element): string => element.textContent ?? '';
    const hasBrokenUnicode = (text: string): boolean => {
      if (text.includes('\uFFFD')) return true;
      for (let index = 0; index < text.length; index += 1) {
        const code = text.charCodeAt(index);
        const previous = text.charCodeAt(index - 1);
        const next = text.charCodeAt(index + 1);
        if (
          (code >= 0xd800 &&
            code <= 0xdbff &&
            !(next >= 0xdc00 && next <= 0xdfff)) ||
          (code >= 0xdc00 &&
            code <= 0xdfff &&
            !(previous >= 0xd800 && previous <= 0xdbff))
        ) {
          return true;
        }
      }
      return false;
    };
    const bounds: TickBounds[] = [];
    const multiline: string[] = [];
    const malformed: string[] = [];
    const clipped: string[] = [];
    for (const element of elements) {
      const text = visibleText(element);
      const rectangle = element.getBoundingClientRect();
      bounds.push({
        text,
        left: rectangle.left,
        right: rectangle.right,
        top: rectangle.top,
        bottom: rectangle.bottom,
      });
      if (element.querySelectorAll('tspan').length > 1) multiline.push(text);
      if (hasBrokenUnicode(text)) malformed.push(text);
      const svgBounds = element
        .closest('foreignObject')
        ?.ownerSVGElement?.getBoundingClientRect();
      if (
        svgBounds === undefined ||
        rectangle.left < svgBounds.left ||
        rectangle.right > svgBounds.right
      ) {
        clipped.push(text);
      }
    }
    return {
      bounds,
      multiline,
      malformed,
      clipped,
      emojiVisible: bounds.some(({ text }) => text.includes('👩‍💻')),
    };
  });
  const overlaps: string[] = [];
  for (const [index, current] of result.bounds.entries()) {
    for (const candidate of result.bounds.slice(index + 1)) {
      const horizontal =
        Math.min(current.right, candidate.right) -
        Math.max(current.left, candidate.left);
      const vertical =
        Math.min(current.bottom, candidate.bottom) -
        Math.max(current.top, candidate.top);
      if (horizontal > 0 && vertical > 0) {
        overlaps.push(`${current.text} <> ${candidate.text}`);
      }
    }
  }
  expect(overlaps).toEqual([]);
  expect(result.multiline).toEqual([]);
  expect(result.malformed).toEqual([]);
  expect(result.clipped).toEqual([]);
  expect(result.emojiVisible).toBe(true);
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth &&
        document.body.scrollWidth <= document.body.clientWidth,
    ),
  ).toBe(true);
}
