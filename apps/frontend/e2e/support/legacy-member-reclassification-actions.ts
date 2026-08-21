import type { Page, Response } from '@playwright/test';
import {
  type CapturedReclassification,
  type LegacyMemberReclassificationFixture,
  RECLASSIFICATION_PATH,
  SESSION_PATH,
  TASK_10_BROWSER_TIMEOUT,
} from './legacy-member-reclassification-fixture';

export async function fillStudentReclassification(
  page: Page,
  request: CapturedReclassification,
): Promise<void> {
  await page.getByLabel('회원 유형').selectOption('STUDENT');
  await page.getByLabel('이름').fill(request.name);
  await page.getByLabel('학번').fill(request.studentId ?? '');
  await page
    .locator('#profile-department')
    .selectOption(request.affiliationName);
}

export async function fillStaffReclassification(
  page: Page,
  request: CapturedReclassification,
): Promise<void> {
  await page.getByLabel('회원 유형').selectOption('STAFF');
  await page.getByLabel('이름').fill(request.name);
  await page.getByLabel('소속 유형').selectOption('PROGRAM_OFFICE');
  await page
    .getByLabel('사업단', { exact: false })
    .fill(request.affiliationName);
}

export function armReclassificationResponse(
  page: Page,
  fixture: LegacyMemberReclassificationFixture,
  status: number,
): Promise<Response> {
  const attempt = fixture.nextReclassificationAttempt();
  return page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      new URL(response.url()).pathname === RECLASSIFICATION_PATH &&
      response.status() === status &&
      response.headers()['x-task10-reclassification-attempt'] ===
        String(attempt),
    { timeout: TASK_10_BROWSER_TIMEOUT },
  );
}

export function armPathResponse(page: Page, path: string): Promise<Response> {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === path && response.status() === 200,
    { timeout: TASK_10_BROWSER_TIMEOUT },
  );
}

export function armSessionResponse(
  page: Page,
  fixture: LegacyMemberReclassificationFixture,
  status: number,
): Promise<Response> {
  const sequence = fixture.nextSessionSequence();
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === SESSION_PATH &&
      response.status() === status &&
      response.headers()['x-task10-session-sequence'] === String(sequence),
    { timeout: TASK_10_BROWSER_TIMEOUT },
  );
}
