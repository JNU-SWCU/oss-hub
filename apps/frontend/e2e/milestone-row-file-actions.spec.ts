import { readFile } from 'node:fs/promises';
import { expect, test } from './admin-session.fixture';
import {
  fixtureProgramId,
  resetProgramAuthoringControl,
} from './support/program-authoring-ui';

const milestoneId = 'e2e:program-authoring:milestone';
const documentId = 'e2e:program-authoring:document';
const firstFile = '운영 결과보고서 최종본 2026.pdf';
const replacementFile =
  '운영 결과보고서_최종_수정본_교직원_검토완료_증빙자료_모음_2026년도_오픈소스_프로젝트_v12.pdf';

// 현행 편집기는 모달의 한 번 저장으로 파일을 반영한다. 행의 다운로드와
// 재업로드 후 reload 보존을 실제 API와 저장된 바이트로 확인한다.
test('마일스톤 행 파일 동작은 실제 Chrome에서 계약을 지킨다', async ({
  authSeedPage,
  programAuthoringActorPage,
}, testInfo) => {
  const controlPage = await authSeedPage('admin-confirmed');
  await resetProgramAuthoringControl(controlPage);
  const programId = await fixtureProgramId(controlPage);
  const page = await programAuthoringActorPage('staff');
  const requests: string[] = [];
  page.on('request', (request) => {
    requests.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto(`/programs/${encodeURIComponent(programId)}/edit`);
  const card = page.locator(`[data-canonical-id="${milestoneId}"]`);
  await expect(card.getByRole('link')).toHaveCount(0);
  await card.getByRole('button', { name: /수정$/ }).click();
  const dialog = page.getByRole('dialog');
  const item = dialog.getByRole('group', { name: `${documentId} 제출 항목` });
  await expect(
    item.locator('button[aria-label="첨부파일 업로드"]'),
  ).toBeVisible();
  await expect(item.getByRole('button', { name: /순서 이동$/ })).toBeDisabled();
  await expect(
    item.getByRole('button', { name: '제출물 이름 수정' }),
  ).toBeVisible();
  await item.locator('input[type="file"]').setInputFiles({
    name: firstFile,
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4\nfirst\n'),
  });
  await expect(item).toContainText(firstFile);
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const firstLink = card.getByRole('link', { name: firstFile, exact: true });
  await expect(firstLink).toBeVisible();
  await expect(firstLink).toHaveAttribute('download', firstFile);
  await expect(firstLink).toHaveAttribute(
    'href',
    `/api/v1/milestones/${encodeURIComponent(milestoneId)}/documents/${encodeURIComponent(documentId)}/template`,
  );

  await card.getByRole('button', { name: /수정$/ }).click();
  await expect(
    item.locator('button[aria-label="첨부파일 재업로드"]'),
  ).toBeVisible();
  const replacementBytes = Buffer.from('%PDF-1.4\nreplacement\n');
  await item.locator('input[type="file"]').setInputFiles({
    name: replacementFile,
    mimeType: 'application/pdf',
    buffer: replacementBytes,
  });
  await expect(item).toContainText(replacementFile);
  await dialog.getByRole('button', { name: '저장', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.reload();
  const link = card.getByRole('link', { name: replacementFile, exact: true });
  await expect(link).toBeVisible();
  await expect(
    card.getByRole('link', { name: firstFile, exact: true }),
  ).toHaveCount(0);
  const downloadPromise = page.waitForEvent('download');
  await link.click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(replacementFile);
  const downloadPath = testInfo.outputPath('replacement.pdf');
  await download.saveAs(downloadPath);
  expect(await readFile(downloadPath)).toEqual(replacementBytes);

  await card.getByRole('button', { name: /수정$/ }).click();
  await item.getByRole('button', { name: '제출 항목 삭제' }).click();
  await expect(dialog.getByText('저장 시 삭제:')).toBeVisible();
  await dialog.getByRole('button', { name: '취소', exact: true }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: '버리기' })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(link).toBeVisible();
  expect(requests.some((request) => request.includes('/preview'))).toBe(false);
  expect(requests.some((request) => request.startsWith('DELETE '))).toBe(false);
  const evidencePath = testInfo.outputPath('row-file-reload.png');
  await card.screenshot({ path: evidencePath });
  await testInfo.attach('row-file-reload', {
    path: evidencePath,
    contentType: 'image/png',
  });
  await testInfo.attach('requests', {
    body: JSON.stringify(requests, null, 2),
    contentType: 'application/json',
  });
});
