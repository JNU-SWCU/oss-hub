import { mkdir } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import {
  expectProgramChartLayout,
  hideNextDevTools,
  PROGRAM_TICK_SELECTOR,
} from './staff-insights-chart-layout';

const target = '/dashboard/insights';
const participationEvidenceDir = '.omo/evidence/participation-program-labels';

async function openFixture(page: Page, fixture: string) {
  await page.goto(`/local-review/${fixture}?to=${encodeURIComponent(target)}`);
  await page.locator('main').waitFor();
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
      // Given: twelve long program names in the participation chart.
      await page.setViewportSize({ width, height: 1000 });
      await openFixture(page, 'insights-long');
      await hideNextDevTools(page);
      const card = page
        .getByText('참여 — 프로그램별', { exact: true })
        .locator('xpath=ancestor::*[@data-slot="card"][1]');

      // When: the chart is rendered at each supported width.
      await card.scrollIntoViewIfNeeded();
      const chartViewport = card.locator(
        '[data-slot="participation-chart-viewport"]',
      );

      // Then: all program labels remain separate without widening the page.
      await expectProgramChartLayout(page);
      const baseProgramLabelFontSize = await page
        .locator(PROGRAM_TICK_SELECTOR)
        .filter({ hasText: '프로그램' })
        .first()
        .evaluate((element) =>
          Number.parseFloat(getComputedStyle(element).fontSize),
        );
      const scrollBounds = await chartViewport.evaluate((element) => ({
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(scrollBounds.clientHeight).toBeLessThanOrEqual(560);
      expect(scrollBounds.scrollHeight).toBeGreaterThan(
        scrollBounds.clientHeight,
      );
      await expect(
        card.locator('[data-slot="participation-chart-legend"]'),
      ).toBeVisible();
      await expect(
        card.locator('[data-slot="participation-chart-scroll-hint"]'),
      ).toBeVisible();
      await expect(chartViewport).toHaveAttribute('role', 'region');
      await expect(chartViewport).toHaveAttribute(
        'aria-label',
        '프로그램별 참여 차트',
      );
      await expect(chartViewport).toHaveAttribute(
        'aria-describedby',
        'participation-chart-scroll-hint',
      );
      await page.mouse.move(0, 0);
      await card.screenshot({
        path: `${participationEvidenceDir}/${name}.png`,
      });
      const keyboardScroll = chartViewport.evaluate(
        (element) =>
          new Promise<number>((resolve, reject) => {
            const timeout = window.setTimeout(() => {
              reject(new Error('키보드 스크롤 이벤트가 발생하지 않았습니다.'));
            }, 2_000);
            element.addEventListener(
              'scrollend',
              () => {
                window.clearTimeout(timeout);
                resolve(element.scrollTop);
              },
              { once: true },
            );
          }),
      );
      await chartViewport.press('PageDown');
      await expect(chartViewport).toBeFocused();
      expect(await keyboardScroll).toBeGreaterThan(0);
      await chartViewport.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      expect(
        await chartViewport.evaluate(
          (element) => getComputedStyle(element).outlineStyle,
        ),
      ).not.toBe('none');
      expect(
        await chartViewport.evaluate(
          (element) => getComputedStyle(element).outlineWidth,
        ),
      ).not.toBe('0px');
      const lastTickBounds = await page
        .locator(PROGRAM_TICK_SELECTOR)
        .filter({ hasText: '프로그램 12' })
        .boundingBox();
      const viewportBounds = await chartViewport.boundingBox();
      if (lastTickBounds === null || viewportBounds === null) {
        throw new Error('차트와 마지막 프로그램의 화면 경계가 필요합니다.');
      }
      expect(lastTickBounds.y).toBeGreaterThanOrEqual(viewportBounds.y);
      expect(lastTickBounds.y + lastTickBounds.height).toBeLessThanOrEqual(
        viewportBounds.y + viewportBounds.height + 2,
      );
      await page.mouse.move(0, 0);
      await chartViewport.screenshot({
        path: `${participationEvidenceDir}/${name}-scrolled.png`,
      });
      await chartViewport.evaluate((element) => {
        element.scrollTop = 0;
      });
      expect(
        await chartViewport.evaluate((element) => element.scrollTop),
      ).toBeLessThanOrEqual(1);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await expectProgramChartLayout(page);
      expect(
        await page
          .locator(PROGRAM_TICK_SELECTOR)
          .filter({ hasText: '프로그램' })
          .first()
          .evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).fontSize),
          ),
      ).toBeGreaterThanOrEqual(baseProgramLabelFontSize * 1.9);
      await page.mouse.move(0, 0);
      await card.screenshot({
        path: `${participationEvidenceDir}/${name}-200-text.png`,
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
      await expectProgramChartLayout(page);
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await expectProgramChartLayout(page);
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
