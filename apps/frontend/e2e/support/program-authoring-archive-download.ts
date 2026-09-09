import { readFile } from 'node:fs/promises';
import { expect, type Page } from '@playwright/test';

export type Scope =
  | { readonly kind: 'PROGRAM' }
  | { readonly kind: 'MILESTONE'; readonly milestoneId: string }
  | { readonly kind: 'TEAM'; readonly teamId: string };
export type Grouping = 'TEAM' | 'DOCUMENT';

export async function downloadScope(
  page: Page,
  scope: Scope,
  grouping: Grouping,
) {
  const panel = page.getByTestId('program-document-archive');
  await panel
    .locator(`input[name="archive-scope"][value="${scope.kind}"]`)
    .check();
  if (scope.kind === 'MILESTONE')
    await panel
      .getByRole('combobox', { name: /^마일스톤/ })
      .selectOption(scope.milestoneId);
  if (scope.kind === 'TEAM')
    await panel
      .getByRole('combobox', { name: /^팀/ })
      .selectOption(scope.teamId);
  await panel.getByLabel('ZIP 폴더 묶기').selectOption(grouping);
  await expect(
    panel.getByTestId('program-document-archive-summary'),
  ).toContainText('이전 제출 이력은 포함하지 않습니다.');
  const [response, download] = await Promise.all([
    page.waitForResponse((item) =>
      item.url().includes('/documents/collection/archive?'),
    ),
    page.waitForEvent('download'),
    panel.getByRole('button', { name: 'ZIP 내려받기', exact: true }).click(),
  ]);
  expect(response.status()).toBe(200);
  const url = new URL(response.url());
  const expected = new URLSearchParams({
    scope: scope.kind,
    groupBy: grouping,
  });
  if (scope.kind === 'MILESTONE')
    expected.set('milestoneId', scope.milestoneId);
  if (scope.kind === 'TEAM') expected.set('teamId', scope.teamId);
  expect([...url.searchParams.entries()].sort()).toEqual(
    [...expected.entries()].sort(),
  );
  expect(await download.failure()).toBeNull();
  const downloadedPath = await download.path();
  if (downloadedPath === null)
    throw new Error('Actual browser ZIP download has no file.');
  return {
    bytes: await readFile(downloadedPath),
    name: download.suggestedFilename(),
    request: `${url.pathname}?${url.searchParams}`,
  };
}
