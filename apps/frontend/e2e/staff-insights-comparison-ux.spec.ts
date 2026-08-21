import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';

const target = '/dashboard/insights';
const programTickSelector = '.recharts-cartesian-axis-tick-value';
const participationEvidenceDir = '.omo/evidence/participation-program-labels';

interface TickBounds {
  readonly text: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

async function openFixture(page: Page, fixture: string) {
  await page.goto(`/local-review/${fixture}?to=${encodeURIComponent(target)}`);
  await page.locator('main').waitFor();
}

async function overlappingProgramTicks(page: Page): Promise<string[]> {
  const ticks = page.locator(programTickSelector).filter({
    hasText: '프로그램',
  });
  await expect(ticks).toHaveCount(8);
  const bounds = await ticks.evaluateAll((elements): TickBounds[] =>
    elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        text: element.textContent ?? '',
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
      };
    }),
  );
  const overlaps: string[] = [];
  for (const [index, current] of bounds.entries()) {
    for (const candidate of bounds.slice(index + 1)) {
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
  return overlaps;
}

test.describe('staff insights comparison UX', () => {
  test('keeps dense program labels separate at responsive widths', async ({
    page,
  }) => {
    await mkdir(participationEvidenceDir, { recursive: true });
    for (const [name, width] of [
      ['desktop', 1280],
      ['tablet', 768],
      ['mobile', 375],
    ] as const) {
      // Given: eight long program names in the participation chart.
      await page.setViewportSize({ width, height: 1000 });
      await openFixture(page, 'insights-long');
      const card = page
        .getByText('참여 — 프로그램별', { exact: true })
        .locator('xpath=ancestor::*[@data-slot="card"][1]');

      // When: the chart is rendered at each supported width.
      await card.scrollIntoViewIfNeeded();

      // Then: all program labels remain separate without widening the page.
      expect(await overlappingProgramTicks(page)).toEqual([]);
      expect(
        await page
          .locator(programTickSelector)
          .filter({ hasText: '프로그램' })
          .evaluateAll((elements) =>
            elements
              .filter((element) => element.querySelectorAll('tspan').length > 1)
              .map((element) => element.textContent ?? ''),
          ),
      ).toEqual([]);
      expect(
        await page
          .locator('main')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await card.screenshot({
        path: `${participationEvidenceDir}/${name}.png`,
      });
    }
  });

  test('renders long Korean labels at desktop and mobile with keyboard and 200% text', async ({
    page,
  }) => {
    for (const [name, width] of [
      ['desktop', 1440],
      ['mobile', 375],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await openFixture(page, 'insights-long');
      await page.keyboard.press('Tab');
      await expect(
        page
          .getByRole('cell', {
            name: '프로그램 1 — 전공·비전공 오픈소스 협업 기초 과정',
          })
          .first(),
      ).toBeVisible();
      expect(await overlappingProgramTicks(page)).toEqual([]);
      expect(
        await page
          .locator('main')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await expect(
        page.getByRole('group', { name: '비교 관점' }),
      ).toBeVisible();
      await page.screenshot({
        path: `.omo/evidence/task-2-browser/${name}-long-200-text.png`,
        fullPage: true,
      });
    }
  });

  test('shows keyboard-only focus indicators without mouse emphasis', async ({
    page,
  }) => {
    for (const [name, width] of [
      ['desktop', 1440],
      ['mobile', 375],
    ] as const) {
      await page.setViewportSize({ width, height: 1000 });
      await openFixture(page, 'insights-long');
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });

      for (const label of ['전공·비전공', '학과'] as const) {
        const button = page.getByRole('button', { name: label });
        await button.click();
        await page.evaluate(() => {
          (document.activeElement as HTMLElement | null)?.blur();
        });
        const mouseFocusVisible = await button.evaluate((element) =>
          element.matches(':focus-visible'),
        );
        await button.focus();
        await expect
          .poll(() =>
            button.evaluate((element) => {
              const style = getComputedStyle(element);
              const hasVisibleOutline =
                style.outlineWidth !== '0px' &&
                style.outlineColor !== 'rgba(0, 0, 0, 0)';
              const hasVisibleShadow = style.boxShadow !== 'none';
              return {
                visible: hasVisibleOutline || hasVisibleShadow,
              };
            }),
          )
          .toMatchObject({ visible: true });
        expect(mouseFocusVisible).toBe(false);
      }
      await page.screenshot({
        path: `.omo/evidence/focus-visible-fix/${name}-200-focus-visible.png`,
        fullPage: true,
      });
    }
  });

  test('renders all-zero state without divide-by-zero output', async ({
    page,
  }) => {
    await openFixture(page, 'insights-zero');
    await expect(page.getByText(/계산 불가|0\/0/).first()).toBeVisible();
    await expect(page.locator('main')).not.toContainText('NaN');
    await page.screenshot({
      path: '.omo/evidence/task-2-browser/all-zero.png',
      fullPage: true,
    });
  });

  test('renders empty state', async ({ page }) => {
    await openFixture(page, 'insights-empty');
    await expect(page.getByText('승인된 참여가 없습니다')).toBeVisible();
    await page.getByRole('button', { name: '학과' }).click();
    await expect(page.getByText('학과별 학생이 없습니다')).toBeVisible();
    await page.screenshot({
      path: '.omo/evidence/task-2-browser/empty.png',
      fullPage: true,
    });
  });

  test('renders unregistered disclosure and semantic parity', async ({
    page,
  }) => {
    await openFixture(page, 'insights-unregistered');
    await expect(page.getByText(/학과 미등록은 별도 집계/)).toBeVisible();
    await expect(
      page.getByRole('table', { name: 'SW전공과 비SW전공의 랭킹 지표' }),
    ).toBeAttached();
    await expect(page.getByText(/색상 외에도 범례와 좌우 위치/)).toBeVisible();
    await expect(page.locator('main')).toContainText('x/0');
    await page.screenshot({
      path: '.omo/evidence/task-2-browser/unregistered-only.png',
      fullPage: true,
    });
  });
});
