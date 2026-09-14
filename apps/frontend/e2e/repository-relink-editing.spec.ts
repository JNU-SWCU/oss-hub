import type { Page } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import { parseRepositoryUrlState } from '../src/features/programs/repository-url-api';
import { expectApiStatus } from './support/program-authoring-flow';
import {
  fixtureProgramId,
  PROGRAM_AUTHORING_CONTROL_PATH,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';
import { capture } from './support/repository-relink-evidence';

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
  const draftReason = '아직 저장하지 않은 변경 사유';
  await editor.getByLabel('새 저장소 URL').fill(draftUrl);
  await editor.getByLabel('변경 사유').fill(draftReason);

  // When: cancel is dismissed with the safe action or Escape, then explicitly confirmed.
  await cancel.click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole('button', { name: '이어서 수정하기' }),
  ).toBeFocused();
  await capture(student, testInfo, 'cancel-confirmation-desktop');
  await dialog.getByRole('button', { name: '이어서 수정하기' }).click();
  await expect(editor.getByLabel('새 저장소 URL')).toHaveValue(draftUrl);
  await expect(editor.getByLabel('변경 사유')).toHaveValue(draftReason);
  await cancel.click();
  await student.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(cancel).toBeFocused();
  await expect(editor.getByLabel('새 저장소 URL')).toHaveValue(draftUrl);
  await expect(editor.getByLabel('변경 사유')).toHaveValue(draftReason);
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
  await expect(editor.getByLabel('변경 사유')).toBeEmpty();
  expect(writes).toEqual([]);
});

test('비공개 저장소 변경 실패는 URL과 사유를 보존하고 기존 연결을 유지한다', async ({
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
  const reason = '공개가 아닌 저장소 연결 검증';
  await student.getByLabel('새 저장소 URL').fill(privateUrl);
  await student.getByLabel('변경 사유').fill(reason);

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
  await expect(student.getByLabel('변경 사유')).toHaveValue(reason);
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
