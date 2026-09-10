import { expect, test } from './admin-session.fixture';
import {
  fixtureProgramId,
  originHeaders,
  programIdFromDetailUrl,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';
import {
  COVER_PNG,
  coverFile,
  createProgramWithCover,
  savedCoverPath,
  saveProgramCover,
} from './support/program-cover';

test.describe('프로그램 대표 이미지', () => {
  test.use({ timezoneId: 'Asia/Seoul' });

  test('교직원이 생성한 이미지를 비로그인 목록·상세와 모바일 전체 보기에서 읽는다', async ({
    authSeedPage,
    browser,
  }) => {
    test.setTimeout(180_000);
    const control = await authSeedPage('admin-confirmed');
    const schedule = await resetProgramAuthoringControl(control);
    const staff = await authSeedPage('staff-revocable');
    await createProgramWithCover(staff, schedule);
    const programId = programIdFromDetailUrl(staff.url());
    if (programId === null)
      throw new Error('Created program is missing from the URL.');
    const path = await savedCoverPath(staff, programId);
    expect(path).not.toBeNull();
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const guest = await context.newPage();
      await guest.goto(`/programs/${encodeURIComponent(programId)}`);
      const image = guest.locator('[data-slot="program-cover"] img').first();
      await expect(image).toBeVisible();
      await expect
        .poll(() =>
          image.evaluate((element: HTMLImageElement) => element.naturalHeight),
        )
        .toBe(3);
      expect((await guest.request.get(`/api/v1${path}`)).status()).toBe(200);
      await guest
        .getByRole('button', {
          name: 'e2e:program-cover:created 대표 이미지 크게 보기',
        })
        .click();
      const dialog = guest.getByRole('dialog');
      await expect(dialog).toBeVisible();
      expect(
        await dialog
          .locator('img')
          .evaluate((element) => getComputedStyle(element).objectFit),
      ).toBe('contain');
      await guest.keyboard.press('Escape');
      await expect(dialog).not.toBeVisible();
      await guest.goto('/programs');
      await guest
        .getByLabel('프로그램명 검색')
        .fill('e2e:program-cover:created');
      const card = guest
        .locator('[data-slot="program-card"]')
        .filter({ hasText: 'e2e:program-cover:created' });
      await expect(card.locator('img')).toBeVisible();
      expect(
        await guest.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    } finally {
      await context.close();
    }
  });

  test('교체·제거는 저장 후에만 반영되고 실패한 저장과 잘못된 파일은 기존 이미지를 지킨다', async ({
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
    await staff.goto(`/programs/${encodeURIComponent(programId)}/edit`);
    await staff.getByLabel('교과/비교과 *').selectOption('EXTRACURRICULAR');
    const field = staff.locator('[data-slot="program-cover-field"]');
    const picker = field.locator('input[type="file"]');
    await picker.setInputFiles(coverFile());
    expect(await savedCoverPath(staff, programId)).toBeNull();
    await saveProgramCover(staff, programId);
    const original = await savedCoverPath(staff, programId);
    expect(original).not.toBeNull();
    await picker.setInputFiles({
      name: 'wrong.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg/>'),
    });
    await expect(field.getByRole('alert')).toContainText('JPG 또는 PNG');
    expect(await savedCoverPath(staff, programId)).toBe(original);
    await picker.setInputFiles(coverFile('replacement.png'));
    expect(await savedCoverPath(staff, programId)).toBe(original);
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
    await expect(field.getByText('replacement.png')).toBeVisible();
    await expect(
      staff
        .locator('[data-slot="field-error"]')
        .filter({ hasText: '다시 저장해 주세요.' }),
    ).toBeVisible();
    expect(await savedCoverPath(staff, programId)).toBe(original);
    await staff.unroute(`**${programPath}`);
    await saveProgramCover(staff, programId);
    const replacement = await savedCoverPath(staff, programId);
    expect(replacement).not.toBe(original);
    expect((await request.get(`/api/v1${original}`)).status()).toBe(404);
    expect((await request.get(`/api/v1${replacement}`)).status()).toBe(200);
    await field
      .getByRole('button', { name: '이미지 제거', exact: true })
      .click();
    expect(await savedCoverPath(staff, programId)).toBe(replacement);
    await saveProgramCover(staff, programId);
    expect(await savedCoverPath(staff, programId)).toBeNull();
    expect((await request.get(`/api/v1${replacement}`)).status()).toBe(404);
    const student = await programAuthoringActorPage('student');
    const denied = await student.request.post(
      '/api/v1/program-authoring/cover-uploads',
      {
        headers: originHeaders(),
        multipart: {
          file: {
            name: 'denied.png',
            mimeType: 'image/png',
            buffer: COVER_PNG,
          },
        },
      },
    );
    expect(denied.status()).toBe(409);
    expect(await denied.json()).toMatchObject({
      detail: 'Program authoring is unavailable.',
      code: 'SYS_004',
    });
  });

  test('서버 저장 후 응답을 읽지 못해도 파일을 다시 고르지 않고 이미지 저장을 복구한다', async ({
    authSeedPage,
    programAuthoringActorPage,
  }) => {
    const control = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(control);
    const programId = await fixtureProgramId(control);
    const programPath = `/api/v1/programs/${encodeURIComponent(programId)}`;
    const staff = await programAuthoringActorPage('staff', {
      status: 400,
      pathname: programPath,
    });
    let uploads = 0;
    staff.on('request', (request) => {
      if (
        request.method() === 'POST' &&
        request.url().endsWith('/cover-uploads')
      )
        uploads += 1;
    });
    await staff.goto(`/programs/${encodeURIComponent(programId)}/edit`);
    await staff.getByLabel('교과/비교과 *').selectOption('EXTRACURRICULAR');
    const field = staff.locator('[data-slot="program-cover-field"]');
    await field
      .locator('input[type="file"]')
      .setInputFiles(coverFile('retained.png'));
    await staff.route(`**${programPath}`, async (route) => {
      if (route.request().method() !== 'PATCH') return route.continue();
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.fulfill({ response: committed, body: '{' });
    });
    await staff.getByRole('button', { name: '프로그램 정보 저장' }).click();
    await expect(
      staff
        .locator('[data-slot="field-error"]')
        .filter({ hasText: '저장에 실패했습니다.' }),
    ).toBeVisible();
    const committedCover = await savedCoverPath(staff, programId);
    expect(committedCover).not.toBeNull();
    await staff.unroute(`**${programPath}`);
    await staff.getByRole('button', { name: '프로그램 정보 저장' }).click();
    await expect(field.getByRole('alert')).toContainText(
      '선택한 이미지는 유지됩니다. 다시 저장해 주세요.',
    );
    await expect(field.getByText('retained.png')).toBeVisible();
    expect(uploads).toBe(1);
    await saveProgramCover(staff, programId);
    expect(uploads).toBe(2);
    expect(await savedCoverPath(staff, programId)).not.toBe(committedCover);
    await expect(field.getByRole('alert')).not.toBeVisible();
  });
});
