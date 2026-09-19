import type { Page } from '@playwright/test';

import { expect, test } from './admin-session.fixture';
import {
  seoulDeadlineDate,
  seoulLocalInput,
} from './support/program-authoring-flow';
import {
  programIdFromDetailUrl,
  resetProgramAuthoringControl,
  selectScheduleRange,
} from './support/program-authoring-ui';
import { installBrowserAudit } from './support/browser-audit';

const DAY_MS = 24 * 60 * 60 * 1000;
const PROGRAM_NAME = 'e2e:anonymous-detail:created';

/**
 * 비로그인 방문자가 프로그램 상세를 열면 401 응답도 콘솔 오류도 없어야 한다(#1294).
 *
 * 화면은 전부터 공개 정보로 그려졌지만, 세션이 없는데도 viewer·overview를 불러 401을
 * 받고 콘솔에 오류 두 줄을 남겼다. 세션 쿠키 없이 진짜 요청으로 판정한다 — 합성
 * 세션을 끼우거나 API를 가로채면 검증 대상 자체가 사라진다.
 */
async function createPublicProgram(
  page: Page,
  schedule: string,
): Promise<string> {
  await page.goto('/programs/new');
  await page.getByLabel('프로그램명 *').fill(PROGRAM_NAME);
  await page
    .getByLabel('주관기관/학과 *')
    .fill('e2e:anonymous-detail:organizer');
  await page.getByLabel('교과/비교과 *').selectOption('EXTRACURRICULAR');
  await page
    .getByLabel('소개/설명 *')
    .fill('비로그인 상세 검증용 합성 프로그램');
  await page.getByRole('button', { name: '계속' }).click();
  await selectScheduleRange(page, {
    rangeLabel: '신청 기간',
    startAt: seoulLocalInput(schedule, -DAY_MS),
    endAt: seoulLocalInput(schedule, 2 * DAY_MS),
  });
  await selectScheduleRange(page, {
    rangeLabel: '운영 기간',
    startAt: seoulLocalInput(schedule, -DAY_MS),
    endAt: seoulLocalInput(schedule, 10 * DAY_MS),
  });
  await page.getByRole('button', { name: '계속' }).click();
  await page.getByRole('button', { name: '마일스톤 추가' }).click();
  const milestone = page.getByRole('dialog');
  const deadline = seoulDeadlineDate(new Date(schedule));
  await milestone.getByLabel('시작일').fill(deadline);
  await milestone.getByLabel('마감일').fill(deadline);
  await milestone.getByLabel('마일스톤 이름 *').fill('합성 마일스톤');
  await milestone.getByRole('button', { name: '저장' }).click();
  await page.getByRole('button', { name: '계속' }).click();
  await page.getByRole('button', { name: '계속' }).click();
  await page.getByRole('button', { name: '프로그램 만들기' }).click();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/program-authoring/programs') &&
      response.request().method() === 'POST',
  );
  await page.getByRole('button', { name: '생성 확정' }).click();
  expect((await created).status()).toBe(201);
  await expect(page).toHaveURL(
    (url) => programIdFromDetailUrl(url.href) !== null,
  );
  const programId = programIdFromDetailUrl(page.url());
  if (programId === null)
    throw new Error('Created program is missing from the URL.');
  return programId;
}

test('비로그인 방문자의 프로그램 상세는 401 응답과 콘솔 오류 없이 공개 정보로 그려진다', async ({
  authSeedPage,
  browser,
}) => {
  test.setTimeout(180_000);
  const control = await authSeedPage('admin-confirmed');
  const schedule = await resetProgramAuthoringControl(control);
  const staff = await authSeedPage('staff-revocable');
  const programId = await createPublicProgram(staff, schedule);

  const context = await browser.newContext();
  try {
    const guest = await context.newPage();
    const audit = installBrowserAudit(guest);
    await guest.goto(`/programs/${encodeURIComponent(programId)}`);
    await expect(
      guest.locator('[data-slot="page-header-title"]').first(),
    ).toContainText(PROGRAM_NAME);
    await expect(guest.getByText('합성 마일스톤')).toBeVisible();
    await guest.waitForLoadState('networkidle');
    audit.assertClean();
  } finally {
    await context.close();
  }
});
