import { expect, type Locator } from '@playwright/test';

interface ContrastReceipt {
  readonly title: number;
  readonly description: number;
  readonly minimum: number;
}

interface KoreanWrappingReceipt {
  readonly phrases: readonly string[];
  readonly wordBreak: string;
  readonly overflowWrap: string;
  readonly horizontalOverflow: boolean;
  readonly brokenPhrases: readonly string[];
}

export async function assertDestructiveAlertContrast(
  alert: Locator,
): Promise<ContrastReceipt> {
  const receipt = await alert.evaluate((element) => {
    function channels(color: string): readonly number[] {
      const values = color.match(/[\d.]+/g)?.map(Number) ?? [];
      if (values.length < 3) throw new Error(`Unsupported color: ${color}`);
      return values;
    }
    function luminance(color: string): number {
      const [red = 0, green = 0, blue = 0, alpha = 1] = channels(color);
      const background = channels(getComputedStyle(element).backgroundColor);
      const linear = [red, green, blue].map((channel, index) => {
        const blended =
          channel * alpha + (background[index] ?? 255) * (1 - alpha);
        const normalized = blended / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return (
        0.2126 * (linear[0] ?? 0) +
        0.7152 * (linear[1] ?? 0) +
        0.0722 * (linear[2] ?? 0)
      );
    }
    function contrast(foreground: string, background: string): number {
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return (
        (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) /
        (Math.min(foregroundLuminance, backgroundLuminance) + 0.05)
      );
    }
    const background = getComputedStyle(element).backgroundColor;
    const title = element.querySelector<HTMLElement>(
      '[data-slot="alert-title"]',
    );
    const description = element.querySelector<HTMLElement>(
      '[data-slot="alert-description"]',
    );
    if (title === null || description === null) {
      throw new Error('Expected destructive alert title and description');
    }
    const titleRatio = contrast(getComputedStyle(title).color, background);
    const descriptionRatio = contrast(
      getComputedStyle(description).color,
      background,
    );
    return {
      title: Number(titleRatio.toFixed(2)),
      description: Number(descriptionRatio.toFixed(2)),
      minimum: Number(Math.min(titleRatio, descriptionRatio).toFixed(2)),
    };
  });
  expect(receipt.minimum).toBeGreaterThanOrEqual(4.5);
  return receipt;
}

export async function assertKoreanWrapping(
  surface: Locator,
  phrases: readonly string[],
): Promise<KoreanWrappingReceipt> {
  const receipt = await surface.evaluate((element, expectedPhrases) => {
    const style = getComputedStyle(element);
    const brokenPhrases = expectedPhrases.filter((phrase) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const start = node.textContent?.indexOf(phrase) ?? -1;
        if (start < 0) continue;
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + phrase.length);
        const lines = new Set(
          Array.from(range.getClientRects()).map((rect) =>
            Math.round(rect.top),
          ),
        );
        return lines.size > 1;
      }
      throw new Error(`Expected phrase not found: ${phrase}`);
    });
    return {
      phrases: expectedPhrases,
      wordBreak: style.wordBreak,
      overflowWrap: style.overflowWrap,
      horizontalOverflow: element.scrollWidth > element.clientWidth + 1,
      brokenPhrases,
    };
  }, phrases);
  expect(receipt.wordBreak).toBe('keep-all');
  expect(receipt.overflowWrap).toBe('anywhere');
  expect(receipt.horizontalOverflow).toBe(false);
  expect(receipt.brokenPhrases).toEqual([]);
  return receipt;
}
