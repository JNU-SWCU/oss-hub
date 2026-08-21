import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  expect,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';

export const TASK_9_VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'narrow', width: 375, height: 812 },
] as const;

const EVIDENCE_DIRECTORY = path.resolve(
  process.cwd(),
  '../../.omo/evidence/jwt-auth-signup-refactor/task-9/visual',
);

export async function captureTask9State(
  page: Page,
  testInfo: TestInfo,
  state: string,
  viewport: (typeof TASK_9_VIEWPORTS)[number],
  target?: Locator,
): Promise<void> {
  await mkdir(EVIDENCE_DIRECTORY, { recursive: true });
  const name = `${state}-${viewport.name}.png`;
  const screenshot = target
    ? await target.screenshot()
    : await page.screenshot({ fullPage: true });
  await writeFile(path.join(EVIDENCE_DIRECTORY, name), screenshot);
  await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
}

export async function captureResponsivePage(
  page: Page,
  testInfo: TestInfo,
  state: string,
): Promise<void> {
  for (const viewport of TASK_9_VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertTask9Layout(page);
    await captureTask9State(page, testInfo, state, viewport);
  }
}

export async function captureResponsiveMenu(
  page: Page,
  testInfo: TestInfo,
  state: string,
): Promise<void> {
  for (const viewport of TASK_9_VIEWPORTS) {
    await page.setViewportSize(viewport);
    let target = page.locator('[data-slot="app-sidebar"]');
    if (viewport.name === 'narrow') {
      const trigger = page.getByRole('button', { name: '메뉴 열기' });
      await trigger.focus();
      await expect(trigger).toBeFocused();
      await page.keyboard.press('Enter');
      target = page.getByRole('dialog');
      await expect(target).toBeVisible();
    }
    await assertTask9Layout(page);
    await captureTask9State(page, testInfo, state, viewport, target);
    if (viewport.name === 'narrow') await page.keyboard.press('Escape');
  }
}

export async function assertTask9Layout(page: Page): Promise<void> {
  const result = await page.locator('body').evaluate(() => {
    const root = document.documentElement;
    const cjk = /[\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af]/;
    const clipped: string[] = [];
    for (const element of document.querySelectorAll<HTMLElement>('body *')) {
      const text = element.textContent?.trim() ?? '';
      if (!cjk.test(text) || element.children.length > 0) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (
        rect.width === 0 ||
        rect.height === 0 ||
        style.visibility === 'hidden'
      ) {
        continue;
      }
      const wraps = style.whiteSpace !== 'nowrap';
      const horizontalClip =
        wraps &&
        style.overflowX === 'visible' &&
        element.scrollWidth > element.clientWidth + 4;
      const verticalClip =
        wraps &&
        style.overflowY === 'visible' &&
        element.scrollHeight > element.clientHeight + 4;
      if (horizontalClip || verticalClip) clipped.push(text.slice(0, 80));
    }
    return {
      documentOverflow: root.scrollWidth > root.clientWidth + 1,
      clipped,
    };
  });

  expect(result.documentOverflow, 'document horizontal overflow').toBe(false);
  expect(result.clipped, 'CJK wrapping or clipping').toEqual([]);
}

export async function assertTabSequence(
  page: Page,
  first: Locator,
  second: Locator,
  key = 'Tab',
): Promise<void> {
  await first.focus();
  await expect(first).toBeFocused();
  await page.keyboard.press(key);
  await expect(second).toBeFocused();
}
