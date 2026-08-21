import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, type TestInfo } from '@playwright/test';

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 900 },
  { name: 'narrow', width: 375, height: 812 },
] as const;

export const TASK_10_REPOSITORY_ROOT = path.resolve(process.cwd(), '../..');
export const TASK_10_VISUAL_DIRECTORY = path.join(
  TASK_10_REPOSITORY_ROOT,
  '.omo/evidence/jwt-auth-signup-refactor/task-10/visual',
);

export interface Task10Screenshot {
  readonly path: string;
  readonly state: string;
  readonly viewport: 'desktop' | 'narrow';
  readonly width: number;
  readonly height: number;
}

export async function captureLegacyReclassification(
  page: Page,
  testInfo: TestInfo,
  state: string,
): Promise<readonly Task10Screenshot[]> {
  await mkdir(TASK_10_VISUAL_DIRECTORY, { recursive: true });
  await page.addStyleTag({
    content: 'nextjs-portal { display: none !important; }',
  });
  const evidence: Task10Screenshot[] = [];
  for (const viewport of VIEWPORTS) {
    await page.setViewportSize(viewport);
    await assertLayout(page);
    const screenshot = await page.screenshot({ fullPage: true });
    const name = `${state}-${viewport.name}.png`;
    const absolutePath = path.join(TASK_10_VISUAL_DIRECTORY, name);
    await writeFile(absolutePath, screenshot);
    await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
    evidence.push({
      path: repositoryRelative(absolutePath),
      state,
      viewport: viewport.name,
      width: viewport.width,
      height: viewport.height,
    });
  }
  return evidence;
}

function repositoryRelative(absolutePath: string): string {
  return path
    .relative(TASK_10_REPOSITORY_ROOT, absolutePath)
    .split(path.sep)
    .join('/');
}

async function assertLayout(page: Page): Promise<void> {
  const result = await page.locator('body').evaluate(() => {
    const root = document.documentElement;
    const target = document.querySelector<HTMLElement>(
      '[data-slot="legacy-member-reclassification"]',
    );
    return {
      documentOverflow: root.scrollWidth > root.clientWidth + 1,
      targetOverflow:
        target !== null && target.scrollWidth > target.clientWidth + 1,
    };
  });
  expect(result).toEqual({ documentOverflow: false, targetOverflow: false });
}
