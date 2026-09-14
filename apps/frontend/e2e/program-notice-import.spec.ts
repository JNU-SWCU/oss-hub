import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import {
  seoulDeadlineDate,
  seoulLocalInput,
} from './support/program-authoring-flow';
import {
  fixtureProgramId,
  programIdFromDetailUrl,
  resetProgramAuthoringControl,
  selectScheduleRange,
} from './support/program-authoring-ui';
import {
  COVER_PNG,
  coverFile,
  savedCoverPath,
  saveProgramCover,
} from './support/program-cover';

const DAY_MS = 24 * 60 * 60 * 1000;
const IMAGE_URL =
  'https://sojoong.kr/wp-content/uploads/kboard_attached/1/209901/e2e-notice-poster.png';
const NOTICE = {
  sourceUrl: 'https://sojoong.kr/notice/notice-board/?uid=9001&mod=document',
  name: 'e2e:program-notice:imported',
  description:
    '합성 공지 소개\n합성 안내 문장입니다.\n\n운영 일정\n• 첫째 날: 합성 활동 A\n• 둘째 날: 합성 활동 B',
  coverImages: [IMAGE_URL],
  warnings: ['EXTERNAL_APPLICATION_LINK'],
};

// Preview and the remote poster stay synthetic at the browser boundary; saves and reloads use the real backend.
async function routeNotice(target: Page | BrowserContext): Promise<void> {
  await target.route('**/api/v1/program-authoring/notice-preview', (route) =>
    route.fulfill({ json: NOTICE }),
  );
  await target.route(IMAGE_URL, (route) =>
    route.fulfill({ contentType: 'image/png', body: COVER_PNG }),
  );
}

async function importNotice(page: Page, select: readonly string[] = []) {
  await page
    .getByRole('button', { name: '공지에서 가져오기', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('sojoong 공지 URL').fill(NOTICE.sourceUrl);
  await dialog.getByRole('button', { name: '불러오기', exact: true }).click();
  await expect(
    dialog.locator('[data-slot="notice-description-preview"]'),
  ).toBeVisible();
  for (const selector of select) await dialog.locator(selector).check();
  await dialog
    .getByRole('button', { name: '선택한 내용 적용', exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
}

test.describe('공지에서 가져오기', () => {
  test.use({ timezoneId: 'Asia/Seoul' });

  test('가져온 내용은 직접 설정한 일정·마일스톤과 함께 생성 확정 뒤에만 저장되고 공개 화면에서 읽힌다', async ({
    authSeedPage,
    browser,
  }) => {
    test.setTimeout(180_000);
    const control = await authSeedPage('admin-confirmed');
    const schedule = await resetProgramAuthoringControl(control);
    const staff = await authSeedPage('staff-revocable');
    await routeNotice(staff);
    const writes: string[] = [];
    staff.on('request', (request) => {
      if (
        request.method() !== 'GET' &&
        request.url().includes('/api/v1/') &&
        !request.url().endsWith('/notice-preview')
      )
        writes.push(request.url());
    });
    await staff.goto('/programs/new');
    await importNotice(staff);
    await expect(staff.getByLabel('프로그램명 *')).toHaveValue(NOTICE.name);
    await expect(staff.getByLabel('소개/설명 *')).toHaveValue(
      NOTICE.description,
    );
    await expect(
      staff.locator('[data-slot="program-cover-preview"] img'),
    ).toHaveAttribute('src', IMAGE_URL);
    await staff
      .getByLabel('주관기관/학과 *')
      .fill('e2e:program-notice:organizer');
    await staff.getByLabel('교과/비교과 *').selectOption('EXTRACURRICULAR');
    await staff.getByRole('button', { name: '계속' }).click();
    await selectScheduleRange(staff, {
      rangeLabel: '신청 기간',
      startAt: seoulLocalInput(schedule, -DAY_MS),
      endAt: seoulLocalInput(schedule, 2 * DAY_MS),
    });
    await selectScheduleRange(staff, {
      rangeLabel: '운영 기간',
      startAt: seoulLocalInput(schedule, -DAY_MS),
      endAt: seoulLocalInput(schedule, 10 * DAY_MS),
    });
    await staff.getByRole('button', { name: '계속' }).click();
    await staff.getByRole('button', { name: '마일스톤 추가' }).click();
    const milestone = staff.getByRole('dialog');
    const deadline = seoulDeadlineDate(new Date(schedule));
    await milestone.getByLabel('시작일').fill(deadline);
    await milestone.getByLabel('마감일').fill(deadline);
    await milestone.getByLabel('마일스톤 이름 *').fill('합성 수동 마일스톤');
    await milestone.getByRole('button', { name: '저장' }).click();
    await staff.getByRole('button', { name: '계속' }).click();
    await staff.getByRole('button', { name: '계속' }).click();
    await expect(staff.getByText('공지에서 가져온 이미지')).toBeVisible();
    expect(writes).toEqual([]);
    await staff.getByRole('button', { name: '프로그램 만들기' }).click();
    const created = staff.waitForResponse(
      (response) =>
        response.url().endsWith('/program-authoring/programs') &&
        response.request().method() === 'POST',
    );
    await staff.getByRole('button', { name: '생성 확정' }).click();
    expect((await created).status()).toBe(201);
    await expect(staff).toHaveURL(
      (url) => programIdFromDetailUrl(url.href) !== null,
    );
    const programId = programIdFromDetailUrl(staff.url());
    if (programId === null)
      throw new Error('Created program is missing from the URL.');
    expect(await savedCoverPath(staff, programId)).toBe(IMAGE_URL);
    const detail = await staff.request.get(
      `/api/v1/programs/${encodeURIComponent(programId)}`,
    );
    const saved = await detail.json();
    expect(saved).toMatchObject({
      name: NOTICE.name,
      description: NOTICE.description,
    });
    expect(saved.milestones).toHaveLength(1);
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      await routeNotice(context);
      const guest = await context.newPage();
      await guest.goto(`/programs/${encodeURIComponent(programId)}`);
      const image = guest.locator('[data-slot="program-cover"] img').first();
      await expect(image).toHaveAttribute('src', IMAGE_URL);
      await expect
        .poll(() =>
          image.evaluate((element: HTMLImageElement) => element.naturalHeight),
        )
        .toBe(3);
      await guest.getByText('프로그램 안내', { exact: true }).click();
      const summary = guest
        .locator('p.whitespace-pre-wrap')
        .filter({ hasText: '합성 안내 문장입니다.' });
      expect(await summary.evaluate((element) => element.textContent)).toBe(
        NOTICE.description,
      );
      expect(
        await guest.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await guest.goto('/programs');
      await guest.getByLabel('프로그램명 검색').fill(NOTICE.name);
      await expect(
        guest
          .locator('[data-slot="program-card"]')
          .filter({ hasText: NOTICE.name })
          .locator('img'),
      ).toHaveAttribute('src', IMAGE_URL);
    } finally {
      await context.close();
    }
    // Later specs share this stack DB without the image route; leave no program pointing at the real host.
    await staff.goto(`/programs/${encodeURIComponent(programId)}/edit`);
    await staff
      .locator('[data-slot="program-cover-field"]')
      .getByRole('button', { name: '이미지 제거', exact: true })
      .click();
    await saveProgramCover(staff, programId);
    expect(await savedCoverPath(staff, programId)).toBeNull();
  });

  test('편집에서 자체 이미지를 공지 이미지로 바꾸면 저장 뒤에만 반영되고 실패한 저장은 선택을 지키며 제거는 새로고침 뒤에도 유지된다', async ({
    authSeedPage,
    programAuthoringActorPage,
    request,
  }) => {
    test.setTimeout(180_000);
    const control = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(control);
    const programId = await fixtureProgramId(control);
    const programPath = `/api/v1/programs/${encodeURIComponent(programId)}`;
    const staff = await programAuthoringActorPage('staff', {
      status: 503,
      pathname: programPath,
    });
    await routeNotice(staff);
    await staff.goto(`/programs/${encodeURIComponent(programId)}/edit`);
    await staff.getByLabel('교과/비교과 *').selectOption('EXTRACURRICULAR');
    const field = staff.locator('[data-slot="program-cover-field"]');
    await field.locator('input[type="file"]').setInputFiles(coverFile());
    await saveProgramCover(staff, programId);
    const owned = await savedCoverPath(staff, programId);
    expect(owned).toMatch(/^\/programs\//);
    const description = await staff.getByLabel('소개/설명 *').inputValue();
    await importNotice(staff, ['input[name="notice-cover"][value="0"]']);
    await expect(field.getByText('공지에서 가져온 이미지')).toBeVisible();
    await expect(staff.getByLabel('소개/설명 *')).toHaveValue(description);
    expect(await savedCoverPath(staff, programId)).toBe(owned);
    await staff.route(`**${programPath}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      await route.fulfill({
        status: 503,
        contentType: 'application/problem+json',
        body: JSON.stringify({
          type: 'about:blank',
          title: '합성 저장 실패',
          status: 503,
          detail: '다시 저장해 주세요.',
          instance: programPath,
          code: 'TST_001',
        }),
      });
    });
    await staff.getByRole('button', { name: '프로그램 정보 저장' }).click();
    await expect(
      staff
        .locator('[data-slot="field-error"]')
        .filter({ hasText: '다시 저장해 주세요.' }),
    ).toBeVisible();
    await expect(field.getByText('공지에서 가져온 이미지')).toBeVisible();
    expect(await savedCoverPath(staff, programId)).toBe(owned);
    await staff.unroute(`**${programPath}`);
    await saveProgramCover(staff, programId);
    expect(await savedCoverPath(staff, programId)).toBe(IMAGE_URL);
    expect((await request.get(`/api/v1${owned}`)).status()).toBe(404);
    await staff.reload();
    await expect(field.getByText('현재 대표 이미지')).toBeVisible();
    await expect(
      staff.locator('[data-slot="program-cover-preview"] img'),
    ).toHaveAttribute('src', IMAGE_URL);
    await field
      .getByRole('button', { name: '이미지 제거', exact: true })
      .click();
    expect(await savedCoverPath(staff, programId)).toBe(IMAGE_URL);
    await saveProgramCover(staff, programId);
    expect(await savedCoverPath(staff, programId)).toBeNull();
    await staff.reload();
    await expect(field.getByText('선택한 이미지 없음')).toBeVisible();
  });
});
