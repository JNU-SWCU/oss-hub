import type { Page } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import { parseRepositoryUrlState } from '../src/features/programs/repository-url-api';
import { expectApiStatus } from './support/program-authoring-flow';
import {
  fixtureProgramId,
  PROGRAM_AUTHORING_CONTROL_PATH,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';
import {
  capture,
  captureRegion,
  RelinkEvidenceError,
} from './support/repository-relink-evidence';

async function provisionApplication(control: Page): Promise<string> {
  await resetProgramAuthoringControl(control);
  const programId = await fixtureProgramId(control);
  await expectApiStatus(
    await control.request.post(
      `${PROGRAM_AUTHORING_CONTROL_PATH}/applications`,
      {
        data: { mode: 'NEW' },
      },
    ),
    201,
  );
  await expectApiStatus(
    await control.request.post(
      `${PROGRAM_AUTHORING_CONTROL_PATH}/approve-and-run`,
    ),
    201,
  );
  return programId;
}

test('수정 중 취소는 입력을 보존하고 명시적으로 버린 경우에만 닫힌다', async ({
  authSeedPage,
  programAuthoringActorPage,
}, testInfo) => {
  // Given: the approved student opens the existing repository editor.
  const programId = await provisionApplication(
    await authSeedPage('admin-confirmed'),
  );
  const student = await programAuthoringActorPage('student');
  const repositoryPath = `/api/v1/programs/${encodeURIComponent(programId)}/applications/me/repository-url`;
  const initialResponse = await student.request.get(repositoryPath);
  await expectApiStatus(initialResponse, 200);
  const initial = parseRepositoryUrlState(await initialResponse.json());
  const writes: string[] = [];
  student.on('request', (request) => {
    if (
      request.method() === 'PATCH' &&
      new URL(request.url()).pathname === repositoryPath
    ) {
      writes.push(request.url());
    }
  });
  await student.goto(`/programs/${encodeURIComponent(programId)}/apply`);
  const editor = student.getByRole('region', {
    name: '프로젝트 저장소',
    exact: true,
  });
  const edit = editor.getByRole('button', { name: '저장소 URL 수정' });
  const cancel = editor.getByRole('button', { name: '취소', exact: true });
  const dialog = student.getByRole('alertdialog');
  await edit.click();
  await cancel.click();
  await expect(edit).toBeVisible();
  await expect(dialog).toBeHidden();
  await edit.click();
  const draftUrl = 'https://github.com/external-owner/relinked-public';
  await editor.getByLabel('새 저장소 URL').fill(draftUrl);
  await expect(editor.getByLabel('변경 사유')).toHaveCount(0);

  // When: cancel is dismissed with the safe action or Escape, then explicitly confirmed.
  await cancel.click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: '이어서 수정하기' }),
  ).toBeFocused();
  await capture(student, testInfo, 'cancel-confirmation-desktop');
  await dialog.getByRole('button', { name: '이어서 수정하기' }).click();
  await expect(editor.getByLabel('새 저장소 URL')).toHaveValue(draftUrl);
  await cancel.click();
  await student.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(cancel).toBeFocused();
  await expect(editor.getByLabel('새 저장소 URL')).toHaveValue(draftUrl);
  await student.setViewportSize({ width: 390, height: 844 });
  await cancel.click();
  await capture(student, testInfo, 'cancel-confirmation-mobile');
  await dialog.getByRole('button', { name: '변경사항 버리기' }).click();

  // Then: reopening shows persisted values and the cancelled edit sent no mutation.
  await expect(edit).toBeVisible();
  await edit.click();
  await expect(editor.getByLabel('새 저장소 URL')).toHaveValue(
    initial.repositoryUrl ?? '',
  );
  expect(writes).toEqual([]);
});

test('비공개 저장소 변경 실패는 URL을 보존하고 기존 연결을 유지한다', async ({
  authSeedPage,
  programAuthoringActorPage,
}) => {
  // Given: an approved application has a provisioned repository.
  const programId = await provisionApplication(
    await authSeedPage('admin-confirmed'),
  );
  const repositoryPath = `/api/v1/programs/${encodeURIComponent(programId)}/applications/me/repository-url`;
  const student = await programAuthoringActorPage('student', {
    status: 400,
    pathname: repositoryPath,
  });
  const initialResponse = await student.request.get(repositoryPath);
  await expectApiStatus(initialResponse, 200);
  const initial = parseRepositoryUrlState(await initialResponse.json());
  await student.goto(`/programs/${encodeURIComponent(programId)}/apply`);
  await student.getByRole('button', { name: '저장소 URL 수정' }).click();
  const privateUrl = 'https://github.com/external-owner/private-repository';
  await student.getByLabel('새 저장소 URL').fill(privateUrl);

  // When: the real API rejects the private repository.
  const [response] = await Promise.all([
    student.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'PATCH' &&
        new URL(candidate.url()).pathname === repositoryPath,
    ),
    student
      .getByRole('button', { name: '저장소 변경 저장', exact: true })
      .click(),
  ]);

  // Then: inputs remain recoverable and explicit discard returns to the unchanged repository.
  expect(response.status()).toBe(400);
  await expect(student.getByLabel('새 저장소 URL')).toHaveValue(privateUrl);
  await student.getByRole('button', { name: '취소', exact: true }).click();
  await student
    .getByRole('alertdialog')
    .getByRole('button', { name: '변경사항 버리기' })
    .click();
  await student.reload();
  const persistedResponse = await student.request.get(repositoryPath);
  await expectApiStatus(persistedResponse, 200);
  expect(parseRepositoryUrlState(await persistedResponse.json())).toEqual(
    initial,
  );
});

test('확인되지 않은 저장 결과는 입력을 유지하고 다시 불러오기 전에는 저장하지 않는다', async ({
  authSeedPage,
  programAuthoringActorPage,
}, testInfo) => {
  // Given: the approved student opens the existing repository editor.
  const programId = await provisionApplication(
    await authSeedPage('admin-confirmed'),
  );
  const student = await programAuthoringActorPage('student');
  const repositoryPath = `/api/v1/programs/${encodeURIComponent(programId)}/applications/me/repository-url`;
  const initialResponse = await student.request.get(repositoryPath);
  await expectApiStatus(initialResponse, 200);
  const initial = parseRepositoryUrlState(await initialResponse.json());
  if (initial.repositoryUrl === null) {
    throw new RelinkEvidenceError(
      'Approved application must expose its repository.',
    );
  }
  const replacementUrl = 'https://github.com/external-owner/relinked-public';
  const unsafeUrl = 'javascript:alert(1)';
  const repositoryRequests: string[] = [];
  student.on('request', (request) => {
    if (new URL(request.url()).pathname === repositoryPath) {
      repositoryRequests.push(request.method());
    }
  });
  await student.goto(`/programs/${encodeURIComponent(programId)}/apply`);
  const editor = student.getByRole('region', {
    name: '프로젝트 저장소',
    exact: true,
  });
  await editor.getByRole('button', { name: '저장소 URL 수정' }).click();
  await expect(
    editor.getByText('저장소 변경 안내', { exact: true }),
  ).toHaveCount(0);
  await editor.getByLabel('새 저장소 URL').fill(replacementUrl);
  await student.route(
    (url) => url.pathname === repositoryPath,
    async (route) => {
      expect(route.request().method()).toBe('PATCH');
      expect(route.request().postDataJSON()).toEqual({
        repositoryUrl: replacementUrl,
      });
      const committed = await route.fetch();
      expect(committed.status()).toBe(200);
      await route.fulfill({
        response: committed,
        body: JSON.stringify({
          repositoryUrl: unsafeUrl,
          canEditRepositoryUrl: true,
        }),
      });
    },
    { times: 1 },
  );

  // When: the browser form submits once and the first successful PATCH is fulfilled unsafely.
  const save = editor.getByRole('button', {
    name: '저장소 변경 저장',
    exact: true,
  });
  const [response] = await Promise.all([
    student.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'PATCH' &&
        new URL(candidate.url()).pathname === repositoryPath,
    ),
    save.click(),
  ]);

  // Then: the write persisted, the outcome is unknown, and reload is GET-only.
  expect(response.status()).toBe(200);
  expect(repositoryRequests.filter((method) => method === 'PATCH')).toEqual([
    'PATCH',
  ]);
  const persistedResponse = await student.request.get(repositoryPath);
  await expectApiStatus(persistedResponse, 200);
  expect(
    parseRepositoryUrlState(await persistedResponse.json()).repositoryUrl,
  ).toBe(replacementUrl);
  await expect(editor.locator('#repository-url')).toHaveValue(replacementUrl);
  const outcome = editor.getByRole('alert').filter({
    hasText: '저장 결과를 확인할 수 없습니다.',
  });
  await expect(outcome).toContainText('저장소 상태 확인');
  await expect(outcome).toContainText('입력은 유지되었습니다.');
  await expect(outcome).toContainText(
    '다시 불러와 현재 상태를 확인한 뒤에만 저장하세요.',
  );
  await expect(outcome).not.toContainText('재시도하세요');
  await expect(save).toBeDisabled();
  await editor.locator('form').evaluate((form) => {
    form.dispatchEvent(
      new Event('submit', { bubbles: true, cancelable: true }),
    );
  });
  expect(repositoryRequests.filter((method) => method === 'PATCH')).toEqual([
    'PATCH',
  ]);
  await expect(editor).not.toContainText(unsafeUrl);
  await expect(editor.locator(`a[href="${unsafeUrl}"]`)).toHaveCount(0);
  await expect(
    editor.getByRole('link', { name: initial.repositoryUrl, exact: true }),
  ).toBeVisible();
  await capture(student, testInfo, 'unknown-outcome-desktop');
  await captureRegion(outcome, testInfo, 'unknown-outcome-alert');
  await student.setViewportSize({ width: 390, height: 844 });
  await capture(student, testInfo, 'unknown-outcome-mobile');
  await captureRegion(outcome, testInfo, 'unknown-outcome-alert-mobile');
  const requestsBeforeReload = repositoryRequests.length;
  const [reloadResponse] = await Promise.all([
    student.waitForResponse(
      (candidate) =>
        candidate.request().method() === 'GET' &&
        new URL(candidate.url()).pathname === repositoryPath,
    ),
    outcome.getByRole('button', { name: '다시 불러오기', exact: true }).click(),
  ]);
  expect(reloadResponse.status()).toBe(200);
  expect(
    parseRepositoryUrlState(await reloadResponse.json()).repositoryUrl,
  ).toBe(replacementUrl);
  expect(repositoryRequests.filter((method) => method === 'PATCH')).toEqual([
    'PATCH',
  ]);
  expect(repositoryRequests.slice(requestsBeforeReload)).toEqual(['GET']);
  await expect(outcome).toBeHidden();
  await expect(save).toBeEnabled();
  await expect(editor.locator('#repository-url')).toHaveValue(replacementUrl);
  await expect(
    editor.getByRole('link', { name: replacementUrl, exact: true }),
  ).toHaveAttribute('href', replacementUrl);
  await expect(editor.locator(`a[href="${unsafeUrl}"]`)).toHaveCount(0);
});
