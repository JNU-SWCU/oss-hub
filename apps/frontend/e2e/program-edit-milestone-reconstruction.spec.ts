import { readFile } from 'node:fs/promises';
import { expect, test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';
import type {
  APIResponse,
  Response as PlaywrightResponse,
} from '@playwright/test';
import { expectApiStatus } from './support/program-authoring-flow';
import {
  fixtureProgramId,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';

const milestoneId = 'e2e:program-authoring:milestone';
const encodedMilestoneId = encodeURIComponent(milestoneId);
const originalDocumentName = 'e2e:program-authoring:document';
const revisedDocumentName = 'e2e:milestone-reconstruction:required.pdf';
const revisedFileBytes = Buffer.from(
  '%PDF-1.4\ne2e milestone reconstruction\n',
);
const longMilestoneName =
  '2026학년도 전남대학교 소프트웨어중심대학사업단 오픈소스소프트웨어 실전 프로젝트 중간 결과물 제출 및 운영 안내 마일스톤';

test.describe('마일스톤 편집 재구성', () => {
  test.use({ timezoneId: 'UTC' });

  test('저장 전 취소와 기본 일정 적용은 쓰지 않고 모바일 본문과 footer가 도달 가능하다', async ({
    authSeedPage,
    programAuthoringActorPage,
  }, testInfo) => {
    const controlPage = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(controlPage);
    const programId = await fixtureProgramId(controlPage);
    const staffPage = await programAuthoringActorPage('staff');
    const writes = observeWrites(staffPage);

    await staffPage.setViewportSize({ width: 390, height: 844 });
    await staffPage.goto(`/programs/${encodeURIComponent(programId)}/edit`);
    await expect(
      staffPage.getByRole('heading', { name: '프로그램 편집' }),
    ).toBeVisible();
    const beforeCancelResponse = await staffPage.request.get(
      `/api/v1/milestones/${encodedMilestoneId}/edit`,
      { headers: originHeadersFor(staffPage.url()) },
    );
    await expectApiStatus(beforeCancelResponse, 200);
    const beforeCancelSnapshot = await beforeCancelResponse.json();
    await expect(
      staffPage.locator('[data-program-schedule-summaries]'),
    ).toBeVisible();
    await expect(
      staffPage.locator('[data-schedule-range-selector]'),
    ).toHaveCount(0);
    await expect(staffPage.locator('[data-calendar-date]')).toHaveCount(0);

    const basicName = staffPage.getByLabel('프로그램명 *');
    await basicName.fill('e2e:basic-local-value');
    const trackType = staffPage.getByLabel('교과/비교과 *');
    await trackType.selectOption('CURRICULAR');
    await expect(trackType).toHaveValue('CURRICULAR');
    const operationEdit = staffPage.getByRole('button', {
      name: '운영 기간 수정',
    });
    await operationEdit.hover();
    await expect(
      staffPage.getByRole('tooltip', { name: '운영 기간 수정' }),
    ).toBeVisible();
    await operationEdit.press('Enter');
    const calendar = staffPage.getByLabel('운영 기간 날짜 선택 달력');
    await expect(calendar).toBeVisible();
    await expect(calendar.locator('[data-calendar-date]')).not.toHaveCount(0);
    await staffPage.getByRole('button', { name: '취소', exact: true }).click();
    await expect(operationEdit).toBeFocused();
    await expect(basicName).toHaveValue('e2e:basic-local-value');

    await staffPage.getByRole('button', { name: '신청 기간 수정' }).click();
    const applicationDialog = staffPage.getByRole('dialog');
    const applicationStartTime =
      applicationDialog.getByLabel('신청 기간 시작 시각');
    const originalApplicationStartTime =
      await applicationStartTime.inputValue();
    const changedApplicationStartTime =
      originalApplicationStartTime === '00:00' ? '00:01' : '00:00';
    await applicationStartTime.fill(changedApplicationStartTime);
    await applicationDialog.getByRole('button', { name: '적용' }).click();
    await expect(
      staffPage.locator('[data-schedule-summary="application"]'),
    ).toContainText(changedApplicationStartTime);
    expect(writes).toEqual([]);

    const milestoneCard = staffPage.locator(
      `[data-canonical-id="${milestoneId}"]`,
    );
    const edit = milestoneCard.getByRole('button', { name: /수정$/ });
    await edit.click();
    const dialog = staffPage.getByRole('dialog');
    await dialog.getByLabel('마일스톤 이름 *').fill('e2e:discarded-milestone');
    const discardedItem = dialog.getByRole('group', {
      name: `${originalDocumentName} 제출 항목`,
    });
    await discardedItem.locator('input[type="file"]').setInputFiles({
      name: 'discarded.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\ndiscard\n'),
    });
    await dialog
      .getByRole('button', { name: '저장', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      dialog.getByRole('button', { name: '저장', exact: true }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await staffPage
      .getByRole('alertdialog')
      .getByRole('button', { name: '버리기' })
      .click();
    await expect(edit).toBeFocused();
    await expect(milestoneCard).toContainText(
      'e2e:program-authoring:milestone',
    );
    expect(writes).toEqual([]);
    const afterCancelResponse = await staffPage.request.get(
      `/api/v1/milestones/${encodedMilestoneId}/edit`,
      { headers: originHeadersFor(staffPage.url()) },
    );
    await expectApiStatus(afterCancelResponse, 200);
    expect(await afterCancelResponse.json()).toEqual(beforeCancelSnapshot);

    await staffPage.setViewportSize({ width: 390, height: 440 });
    await edit.click();
    const compactDialog = staffPage.getByRole('dialog');
    await compactDialog.getByLabel('마일스톤 이름 *').fill(longMilestoneName);
    await compactDialog
      .getByLabel('운영자 공지')
      .fill(
        '긴 이름에서도 운영 안내와 서류 목록을 스크롤로 확인할 수 있습니다.',
      );
    const body = compactDialog.locator('form > div').first();
    await expect(body).toBeVisible();
    await expect
      .poll(() =>
        body.evaluate(
          (element) =>
            element.clientHeight > 0 &&
            element.scrollHeight > element.clientHeight,
        ),
      )
      .toBe(true);
    const localItemsHeading = compactDialog.getByText('제출 항목', {
      exact: true,
    });
    await localItemsHeading.scrollIntoViewIfNeeded();
    await expect(localItemsHeading).toHaveText('제출 항목');
    await compactDialog
      .getByRole('button', { name: '저장', exact: true })
      .scrollIntoViewIfNeeded();
    await expect(
      compactDialog.getByRole('button', { name: '저장', exact: true }),
    ).toBeVisible();
    await expect(
      compactDialog.getByRole('button', { name: '취소', exact: true }),
    ).toBeVisible();
    await compactDialog
      .getByRole('button', { name: '취소', exact: true })
      .click();
    await staffPage
      .getByRole('alertdialog')
      .getByRole('button', { name: '버리기' })
      .click();
    expect(writes).toEqual([]);

    await staffPage.setViewportSize({ width: 390, height: 844 });
    await expect(basicName).toBeVisible();
    const image = await staffPage.screenshot({
      path: testInfo.outputPath('mobile-basic-and-milestone-cancel.png'),
      fullPage: true,
    });
    expect(new Set(image).size).toBeGreaterThan(32);
    await testInfo.attach('mobile-basic-and-milestone-cancel', {
      path: testInfo.outputPath('mobile-basic-and-milestone-cancel.png'),
      contentType: 'image/png',
    });
    const [programPatch] = await Promise.all([
      staffPage.waitForResponse(
        (response) =>
          response
            .url()
            .includes(`/api/v1/programs/${encodeURIComponent(programId)}`) &&
          response.request().method() === 'PATCH',
      ),
      staffPage.getByRole('button', { name: '변경사항 저장' }).click(),
    ]);
    expect(programPatch.ok()).toBe(true);
    expect(writes.filter((entry) => entry.kind === 'program')).toHaveLength(1);
  });

  test('마일스톤 한 번 저장은 canonical 문서와 파일을 reload와 다운로드까지 보존하고 기본 입력도 남긴다', async ({
    authSeedPage,
    programAuthoringActorPage,
  }, testInfo) => {
    const controlPage = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(controlPage);
    const programId = await fixtureProgramId(controlPage);
    const staffPage = await programAuthoringActorPage('staff');
    const writes = observeWrites(staffPage);

    await staffPage.setViewportSize({ width: 1440, height: 900 });
    await staffPage.goto(`/programs/${encodeURIComponent(programId)}/edit`);
    expect(
      await staffPage.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    ).toBe('UTC');
    const basicName = staffPage.getByLabel('프로그램명 *');
    await basicName.fill('e2e:basic-value-survives-milestone-save');
    const card = staffPage.locator(`[data-canonical-id="${milestoneId}"]`);
    await card.getByRole('button', { name: /수정$/ }).click();
    const dialog = staffPage.getByRole('dialog');
    await dialog.getByLabel('마일스톤 이름 *').fill('e2e:canonical-milestone');
    await dialog.getByLabel('운영자 공지').fill('e2e:canonical-notice');
    await dialog
      .getByRole('button', {
        name: 'e2e:canonical-milestone 일정 입력',
      })
      .click();
    const scheduleDialog = staffPage.getByRole('dialog').last();
    const originalDueDate = await scheduleDialog
      .getByLabel('e2e:canonical-milestone 종료일')
      .inputValue();
    const originalDueTime = await scheduleDialog
      .getByLabel('e2e:canonical-milestone 종료 시각')
      .inputValue();
    const changedDueAt = `${nextDate(originalDueDate)}T${originalDueTime}`;
    await scheduleDialog
      .getByLabel('e2e:canonical-milestone 종료일')
      .fill(nextDate(originalDueDate));
    await scheduleDialog
      .getByRole('button', { name: '저장', exact: true })
      .click();
    const item = dialog.getByRole('group', {
      name: `${originalDocumentName} 제출 항목`,
    });
    await item.getByRole('button', { name: '제출물 이름 수정' }).click();
    await item.getByLabel('파일 제출물 이름').fill('e2e:canonical-document');
    const renamedItem = dialog.getByRole('group', {
      name: 'e2e:canonical-document 제출 항목',
    });
    const saveRenamedItem = renamedItem.getByRole('button', {
      name: '제출물 이름 저장',
    });
    await expect(saveRenamedItem).toBeEnabled();
    await saveRenamedItem.click();
    await renamedItem.getByLabel('필수 제출').uncheck();
    await renamedItem.locator('input[type="file"]').setInputFiles({
      name: revisedDocumentName,
      mimeType: 'application/pdf',
      buffer: revisedFileBytes,
    });
    await dialog.getByRole('button', { name: '제출 항목 추가' }).click();
    const addedItem = dialog.getByRole('group', { name: '새 제출 항목' });
    await addedItem.getByRole('button', { name: '제출물 이름 수정' }).click();
    await addedItem.getByLabel('파일 제출물 이름').fill('e2e:added-document');
    const namedAddedItem = dialog.getByRole('group', {
      name: 'e2e:added-document 제출 항목',
    });
    const saveAddedItem = namedAddedItem.getByRole('button', {
      name: '제출물 이름 저장',
    });
    await expect(saveAddedItem).toBeEnabled();
    await saveAddedItem.click();
    const addedHandle = dialog.getByRole('button', {
      name: 'e2e:added-document 순서 이동',
    });
    await addedHandle.press('Enter');
    await addedHandle.press('ArrowUp');
    await addedHandle.press('Enter');

    const [patch] = await Promise.all([
      staffPage.waitForResponse(
        (response) =>
          response.url().includes(`/api/v1/milestones/${encodedMilestoneId}`) &&
          response.request().method() === 'PATCH',
      ),
      dialog.getByRole('button', { name: '저장', exact: true }).click(),
    ]);
    expect(patch.ok()).toBe(true);
    expect(milestonePatchBody(patch)).toMatchObject({
      dueAt: seoulDateTimeToIso(changedDueAt),
    });
    await expect(staffPage.getByRole('dialog')).toHaveCount(0);
    expect(writes.filter((entry) => entry.kind === 'milestone')).toHaveLength(
      1,
    );
    await expect(card).toContainText('e2e:canonical-milestone');
    await expect(card).toContainText('e2e:canonical-notice');
    await expect(basicName).toHaveValue(
      'e2e:basic-value-survives-milestone-save',
    );

    await staffPage.reload();
    const reloadedCard = staffPage.locator(
      `[data-canonical-id="${milestoneId}"]`,
    );
    await expect(reloadedCard).toContainText('e2e:canonical-milestone');
    await expect(reloadedCard).toContainText('e2e:canonical-notice');
    await expect(reloadedCard).toContainText('e2e:canonical-document');
    await expect(reloadedCard).toContainText('e2e:added-document');
    const templateLink = reloadedCard.getByRole('link', {
      name: revisedDocumentName,
    });
    await expect(templateLink).toBeVisible();
    const downloadPromise = staffPage.waitForEvent('download');
    await templateLink.click();
    const download = await downloadPromise;
    /*
     * 서버는 콜론처럼 안전하지 않은 문자를 밑줄로 정규화해 내려준다 — 제출 파일 업로드
     * 계약의 파일명 정규화와 같은 규칙이다. 그래서 올린 이름과 같기를 기대하지 않고
     * 정규화된 이름을 단언한다. 내용 동일성은 아래 바이트 비교가 증명한다.
     */
    const sanitizedDocumentName = revisedDocumentName.replaceAll(':', '_');
    expect(download.suggestedFilename()).toBe(sanitizedDocumentName);
    const downloadPath = testInfo.outputPath(sanitizedDocumentName);
    await download.saveAs(downloadPath);
    expect(await readFile(downloadPath)).toEqual(revisedFileBytes);
    const imagePath = testInfo.outputPath('desktop-canonical-milestone.png');
    const image = await staffPage.screenshot({
      path: imagePath,
      fullPage: true,
    });
    expect(new Set(image).size).toBeGreaterThan(32);
    await testInfo.attach('desktop-canonical-milestone', {
      path: imagePath,
      contentType: 'image/png',
    });
  });

  test('알려진 400 뒤 재시도는 선택한 파일을 유지하고 실제 PATCH 하나로 수렴한다', async ({
    authSeedPage,
    programAuthoringActorPage,
  }) => {
    const controlPage = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(controlPage);
    const programId = await fixtureProgramId(controlPage);
    const expectedPathname = `/api/v1/milestones/${encodedMilestoneId}`;
    const staffPage = await programAuthoringActorPage('staff', {
      status: 400,
      pathname: expectedPathname,
    });
    const fulfilledRequests: string[] = [];
    const fulfilledPaths: string[] = [];
    await staffPage.route(
      `**/api/v1/milestones/${encodedMilestoneId}`,
      async (route) => {
        if (
          route.request().method() !== 'PATCH' ||
          fulfilledRequests.length > 0
        )
          return route.continue();
        fulfilledRequests.push(route.request().method());
        fulfilledPaths.push(new URL(route.request().url()).pathname);
        await route.fulfill({
          status: 400,
          contentType: 'application/problem+json',
          body: JSON.stringify(
            mockedProblemDetail(
              400,
              'PRG_001',
              '알려진 검증 오류입니다.',
              expectedPathname,
            ),
          ),
        });
      },
    );
    await staffPage.goto(`/programs/${encodeURIComponent(programId)}/edit`);
    await staffPage
      .locator(`[data-canonical-id="${milestoneId}"]`)
      .getByRole('button', { name: /수정$/ })
      .click();
    const dialog = staffPage.getByRole('dialog');
    const item = dialog.getByRole('group', {
      name: `${originalDocumentName} 제출 항목`,
    });
    await item.locator('input[type="file"]').setInputFiles({
      name: revisedDocumentName,
      mimeType: 'application/pdf',
      buffer: revisedFileBytes,
    });
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(dialog.getByText('알려진 검증 오류입니다.')).toBeVisible();
    await expect(dialog.getByText(revisedDocumentName)).toBeVisible();
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(staffPage.getByRole('dialog')).toHaveCount(0);
    expect(fulfilledRequests).toEqual(['PATCH']);
    expect(fulfilledPaths).toEqual([expectedPathname]);
  });

  test('canonical 409 충돌은 입력을 보존하고 자동 재시도를 막는다', async ({
    authSeedPage,
    programAuthoringActorPage,
  }) => {
    const controlPage = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(controlPage);
    const programId = await fixtureProgramId(controlPage);
    const expectedPathname = `/api/v1/milestones/${encodedMilestoneId}`;
    const staffPage = await programAuthoringActorPage('staff', {
      status: 409,
      pathname: expectedPathname,
    });
    const fulfilledRequests: string[] = [];
    const fulfilledPaths: string[] = [];
    await staffPage.route(
      `**/api/v1/milestones/${encodedMilestoneId}`,
      async (route) => {
        if (route.request().method() !== 'PATCH') return route.continue();
        fulfilledRequests.push(route.request().method());
        fulfilledPaths.push(new URL(route.request().url()).pathname);
        await route.fulfill({
          status: 409,
          contentType: 'application/problem+json',
          body: JSON.stringify(
            mockedProblemDetail(
              409,
              'PRG_016',
              'stale milestone',
              expectedPathname,
            ),
          ),
        });
      },
    );
    await staffPage.goto(`/programs/${encodeURIComponent(programId)}/edit`);
    await staffPage
      .locator(`[data-canonical-id="${milestoneId}"]`)
      .getByRole('button', { name: /수정$/ })
      .click();
    const dialog = staffPage.getByRole('dialog');
    await dialog
      .getByLabel('마일스톤 이름 *')
      .fill('e2e:conflict-input-survives');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(
      dialog.getByText(
        '다른 변경과 충돌했습니다. 입력은 유지됩니다. 새로고침한 뒤 내용을 확인하세요.',
      ),
    ).toBeVisible();
    await expect(dialog.getByLabel('마일스톤 이름 *')).toHaveValue(
      'e2e:conflict-input-survives',
    );
    await expect(
      dialog.getByRole('button', { name: '저장', exact: true }),
    ).toBeDisabled();
    expect(fulfilledRequests).toEqual(['PATCH']);
    expect(fulfilledPaths).toEqual([expectedPathname]);
  });

  test('알 수 없는 저장 결과는 새로고침 뒤에도 명시적 최신 상태 재시작 전에는 재시도하지 않는다', async ({
    authSeedPage,
    programAuthoringActorPage,
  }) => {
    const controlPage = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(controlPage);
    const programId = await fixtureProgramId(controlPage);
    const expectedPathname = `/api/v1/milestones/${encodedMilestoneId}`;
    const staffPage = await programAuthoringActorPage('staff', {
      status: 503,
      pathname: expectedPathname,
    });
    const fulfilledRequests: string[] = [];
    const fulfilledPaths: string[] = [];
    await staffPage.route(
      `**/api/v1/milestones/${encodedMilestoneId}`,
      async (route) => {
        if (
          route.request().method() !== 'PATCH' ||
          fulfilledRequests.length > 0
        )
          return route.continue();
        fulfilledRequests.push(route.request().method());
        fulfilledPaths.push(new URL(route.request().url()).pathname);
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify(
            mockedProblemDetail(503, 'API_000', 'unknown', expectedPathname),
          ),
        });
      },
    );
    await staffPage.goto(`/programs/${encodeURIComponent(programId)}/edit`);
    await staffPage
      .locator(`[data-canonical-id="${milestoneId}"]`)
      .getByRole('button', { name: /수정$/ })
      .click();
    const dialog = staffPage.getByRole('dialog');
    await dialog.getByLabel('마일스톤 이름 *').fill('e2e:unknown-outcome');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(
      dialog.getByText(
        '저장 결과를 확인할 수 없습니다. 입력은 유지됩니다. 새로고침으로 서버 상태를 확인하세요.',
      ),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: '저장', exact: true }),
    ).toBeDisabled();
    await dialog.getByRole('button', { name: '새로고침' }).click();
    await expect(
      dialog.getByRole('button', { name: '최신 서버 상태로 다시 시작' }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: '저장', exact: true }),
    ).toBeDisabled();
    await dialog
      .getByRole('button', { name: '최신 서버 상태로 다시 시작' })
      .click();
    await expect(
      dialog.getByRole('button', { name: '저장', exact: true }),
    ).toBeEnabled();
    expect(fulfilledRequests).toEqual(['PATCH']);
    expect(fulfilledPaths).toEqual([expectedPathname]);
  });
});

type Write = {
  readonly kind: 'milestone' | 'program' | 'upload';
  readonly url: string;
};

function observeWrites(page: import('@playwright/test').Page): Write[] {
  const writes: Write[] = [];
  page.on('request', (request) => {
    if (!['PATCH', 'POST', 'DELETE'].includes(request.method())) return;
    const path = new URL(request.url()).pathname;
    if (/\/api\/v1\/milestones\/[^/]+$/u.test(path))
      writes.push({ kind: 'milestone', url: path });
    else if (/\/api\/v1\/programs\/[^/]+$/u.test(path))
      writes.push({ kind: 'program', url: path });
    else if (path.includes('/program-authoring/uploads'))
      writes.push({ kind: 'upload', url: path });
  });
  return writes;
}

function originHeadersFor(referer: string): Record<string, string> {
  return {
    Origin: e2eEnvironment.baseUrl,
    Referer: referer,
  };
}

function mockedProblemDetail(
  status: number,
  code: string,
  detail: string,
  instance: string,
) {
  return {
    type: 'about:blank',
    title: 'Expected milestone edit failure',
    status,
    detail,
    instance,
    code,
  };
}

function milestonePatchBody(
  response: PlaywrightResponse,
): Record<string, unknown> {
  const body: unknown = response.request().postDataJSON();
  if (typeof body !== 'object' || body === null || Array.isArray(body))
    throw new Error('Milestone PATCH body must be an object.');
  return body as Record<string, unknown>;
}

function seoulDateTimeToIso(value: string): string {
  return new Date(`${value}:00+09:00`).toISOString();
}

function nextDate(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (match === null)
    throw new Error(`Expected date value, received ${value}.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return next.toISOString().slice(0, 10);
}
