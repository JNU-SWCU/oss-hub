import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { seoulDeadlineDate, seoulLocalInput } from './program-authoring-flow';
import {
  programIdFromDetailUrl,
  selectScheduleRange,
} from './program-authoring-ui';

const DAY_MS = 24 * 60 * 60 * 1000;

export const COVER_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAIAAAA2iEnWAAAAEklEQVR4nGNgMJ7JMMmeAYUCADBIBNhmr6VDAAAAAElFTkSuQmCC',
  'base64',
);

export const coverFile = (name = 'synthetic-poster.png') => ({
  name,
  mimeType: 'image/png',
  buffer: COVER_PNG,
});

export async function createProgramWithCover(
  page: Page,
  schedule: string,
): Promise<void> {
  await page.goto('/programs/new');
  await page.getByLabel('프로그램명 *').fill('e2e:program-cover:created');
  await page.getByLabel('주관기관/학과 *').fill('e2e:program-cover:organizer');
  await page.getByLabel('교과/비교과 *').selectOption('EXTRACURRICULAR');
  await page.getByLabel('소개/설명 *').fill('합성 대표 이미지 검증 프로그램');
  await page
    .locator('[data-slot="program-cover-field"] input[type="file"]')
    .setInputFiles(coverFile());
  await expect(
    page.locator('[data-slot="program-cover-field"] img'),
  ).toBeVisible();
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
  await expect(page.getByText('synthetic-poster.png')).toBeVisible();
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
}

export async function savedCoverPath(
  page: Page,
  programId: string,
): Promise<string | null> {
  const response = await page.request.get(
    `/api/v1/programs/${encodeURIComponent(programId)}`,
  );
  expect(response.status()).toBe(200);
  const value: unknown = await response.json();
  if (
    typeof value !== 'object' ||
    value === null ||
    !('coverImageUrl' in value)
  )
    throw new Error('Program detail must contain coverImageUrl.');
  if (value.coverImageUrl !== null && typeof value.coverImageUrl !== 'string')
    throw new Error('Program cover must be a URL or null.');
  return value.coverImageUrl;
}

export async function saveProgramCover(
  page: Page,
  programId: string,
): Promise<void> {
  const saved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/programs/${encodeURIComponent(programId)}`) &&
      response.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: '프로그램 정보 저장' }).click();
  expect((await saved).status()).toBe(200);
  await expect(
    page.getByText('저장되었습니다.', { exact: true }),
  ).toBeVisible();
}
