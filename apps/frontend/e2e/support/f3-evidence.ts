import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Page, TestInfo } from '@playwright/test';

const F3_EVIDENCE_DIRECTORY = path.resolve(
  process.env.E2E_F3_EVIDENCE_DIR ??
    path.join(
      process.cwd(),
      '../../.omo/evidence/jwt-auth-signup-refactor/final',
    ),
);

export async function captureF3Evidence(
  page: Page,
  testInfo: TestInfo,
  scenario: string,
): Promise<void> {
  await mkdir(F3_EVIDENCE_DIRECTORY, { recursive: true });
  const name = `f3-${scenario}.png`;
  const screenshot = await page.screenshot({ fullPage: true });
  await writeFile(path.join(F3_EVIDENCE_DIRECTORY, name), screenshot);
  await testInfo.attach(name, { body: screenshot, contentType: 'image/png' });
}
