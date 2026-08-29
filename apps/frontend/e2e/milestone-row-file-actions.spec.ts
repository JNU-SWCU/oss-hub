import { expect, test } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';

const programId = 'program-p5';
const milestoneId = 'milestone-p5';
const documentId = 'document-p5';
const firstFile = '운영 결과보고서 최종본 2026.docx';
const replacementFile =
  '운영 결과보고서_최종_수정본_교직원_검토완료_증빙자료_모음_2026년도_오픈소스_프로젝트_v12.docx';

test('마일스톤 행 파일 동작은 실제 Chrome에서 계약을 지킨다', async ({
  page,
}) => {
  const evidenceDir = '.omo/evidence/task-6-browser';
  await mkdir(evidenceDir, { recursive: true });
  let persistedFileName: string | null = null;
  const requests: string[] = [];
  const document = () => ({
    id: documentId,
    milestoneId,
    name: '기획서',
    required: true,
    sortOrder: 1,
    hasTemplateFile: persistedFileName !== null,
    templateFileName: persistedFileName,
  });

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    requests.push(`${request.method()} ${path}`);
    if (path === '/api/v1/auth/session') {
      await route.fulfill({
        json: {
          isAuthenticated: true,
          user: {
            nickname: 'qa',
            name: 'QA',
            email: null,
            avatarUrl: null,
            memberKind: 'STAFF',
            hasStaffAccess: true,
            hasAdminAccess: false,
            isProfileComplete: true,
          },
        },
      });
      return;
    }
    if (
      path === `/api/v1/programs/${programId}/edit` &&
      request.method() === 'GET'
    ) {
      await route.fulfill({
        json: {
          id: programId,
          name: 'P5 합성 프로그램',
          organizer: 'QA',
          category: 'BASIC',
          lifecycle: 'PUBLISHED',
          applicationTemplateKey: 'basic',
          applicationTemplateVersion: 1,
          applicationCount: 0,
          categoryLocked: {
            locked: false,
            byApplications: false,
            byTeams: false,
            applicationCount: 0,
            teamCount: 0,
          },
          applicationStartAt: '2026-08-01T00:00:00.000Z',
          applicationEndAt: '2026-08-15T00:00:00.000Z',
          startAt: '2026-08-16T00:00:00.000Z',
          endAt: '2026-08-31T00:00:00.000Z',
          repositoryProvisioningEnabled: false,
          notifyOnDeadline: false,
          description: '',
          teamMinSize: 1,
          teamMaxSize: 4,
          milestones: [
            {
              id: milestoneId,
              name: '최종 제출',
              startAt: '2026-08-16T00:00:00.000Z',
              dueAt: '2026-08-31T00:00:00.000Z',
              submissionType: 'FILE',
              instructions: '',
              requirements: [],
            },
          ],
        },
      });
      return;
    }
    if (
      path === `/api/v1/milestones/${milestoneId}/documents` &&
      request.method() === 'GET'
    ) {
      await route.fulfill({ json: [document()] });
      return;
    }
    if (
      path ===
        `/api/v1/milestones/${milestoneId}/documents/${documentId}/template` &&
      request.method() === 'POST'
    ) {
      const body = await request.postDataBuffer();
      const match = body?.toString('utf8').match(/filename="([^"]+)"/);
      persistedFileName = match?.[1] ?? null;
      await route.fulfill({
        json: {
          documentId,
          hasTemplateFile: true,
          fileName: persistedFileName,
          uploadedAt: '2026-08-20T00:00:00.000Z',
        },
      });
      return;
    }
    if (
      path ===
        `/api/v1/milestones/${milestoneId}/documents/${documentId}/template` &&
      request.method() === 'GET'
    ) {
      await route.fulfill({
        status: 200,
        contentType:
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        headers: {
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(persistedFileName ?? '')}`,
        },
        body: 'synthetic-docx',
      });
      return;
    }
    if (
      path === `/api/v1/milestones/${milestoneId}/documents/${documentId}` &&
      request.method() === 'DELETE'
    ) {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (path === `/api/v1/milestones/${milestoneId}/documents/order`) {
      await route.fulfill({ json: [document()] });
      return;
    }
    await route.fulfill({ json: null });
  });

  await page.goto(`/programs/${programId}/edit#milestones`);
  await page.locator('#milestones').scrollIntoViewIfNeeded();
  await writeFile(
    `${evidenceDir}/initial-text.txt`,
    await page.locator('body').innerText(),
  );
  const toggle = page.getByRole('button', { name: /제출 항목/ });
  const section = toggle.locator('xpath=../..');
  await expect(toggle).toBeAttached();
  await toggle.click();
  await expect(section.getByText('양식 올리기')).toBeVisible();
  await expect(section.getByText(firstFile)).toHaveCount(0);
  await page.screenshot({
    path: `${evidenceDir}/01-no-template.png`,
    fullPage: true,
  });

  const chooser = page.getByLabel('운영 결과보고서 양식 파일 선택');
  await chooser.setInputFiles({
    name: firstFile,
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('first'),
  });
  await expect(section.getByText(firstFile, { exact: true })).toBeVisible();
  await expect(section.locator('a[download]').first()).toHaveAttribute(
    'href',
    /milestones\/milestone-p5\/documents\/document-p5\/template/,
  );
  await expect(section.locator('a[download]').first()).toHaveAttribute(
    'title',
    firstFile,
  );
  await page.screenshot({
    path: `${evidenceDir}/02-uploaded.png`,
    fullPage: true,
  });

  await chooser.setInputFiles({
    name: replacementFile,
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from('replacement'),
  });
  await expect(
    section.getByText(replacementFile, { exact: true }),
  ).toBeVisible();
  const downloadHref = await section
    .locator('a[download]')
    .first()
    .getAttribute('href');
  expect(downloadHref).not.toBeNull();
  if (downloadHref === null) throw new Error('Download href is missing.');
  const downloadResponse = await page.evaluate(async (href) => {
    const response = await fetch(href);
    return {
      status: response.status,
      disposition: response.headers.get('content-disposition'),
      body: await response.text(),
    };
  }, downloadHref);
  expect(downloadResponse.status).toBe(200);
  expect(downloadResponse.disposition).toContain(
    encodeURIComponent(replacementFile),
  );
  await writeFile(
    `${evidenceDir}/template-download.docx`,
    downloadResponse.body,
  );
  await page.reload();
  await section.getByRole('button', { name: /제출 항목/ }).click();
  await expect(
    section.getByText(replacementFile, { exact: true }),
  ).toBeVisible();

  await expect(
    section.getByRole('button', { name: '운영 결과보고서 순서 이동' }),
  ).toBeDisabled();
  await expect(
    section.getByRole('button', { name: '수정', exact: true }),
  ).toBeVisible();
  await expect(
    section.getByRole('button', { name: '삭제', exact: true }),
  ).toBeVisible();
  await section.getByRole('button', { name: '삭제', exact: true }).click();
  await expect(section.getByText('되돌릴 수 없습니다.')).toBeVisible();
  await section.getByRole('button', { name: '취소' }).click();
  await expect(
    section.getByText(replacementFile, { exact: true }),
  ).toBeVisible();

  await writeFile(
    `${evidenceDir}/requests.json`,
    JSON.stringify(requests, null, 2),
  );
  await page.screenshot({
    path: `${evidenceDir}/03-reload-menu-cancel-reorder.png`,
    fullPage: true,
  });
  expect(requests.some((request) => request.includes('storage'))).toBe(false);
  expect(requests.some((request) => request.includes('/preview'))).toBe(false);
});
