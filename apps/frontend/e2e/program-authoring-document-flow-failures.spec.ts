import type { Page } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import { coverFile } from './support/program-cover';
import {
  expectApiStatus,
  expectCleanState,
  parseDeadlinePreview,
  seoulDeadlineDate,
  seoulLocalInput,
  toStateCounts,
  writeArtifact,
} from './support/program-authoring-flow';
import {
  fixtureProgramId,
  originHeaders,
  resetProgramAuthoringControl,
  selectScheduleRange,
  submitProgramApplication,
} from './support/program-authoring-ui';

const controlPath = '/api/v1/_e2e/program-authoring';
const milestoneId = 'e2e:program-authoring:milestone';
const documentId = 'e2e:program-authoring:document';
const studentUserId = 'e2e:program-authoring:student';
const failures = ['upload', 'prisma', 'smtp', 'github', 'cleanup'] as const;

test.describe('프로그램 작성 dry-run 실패 격리', () => {
  test.use({ timezoneId: 'Asia/Seoul' });

  for (const failure of failures) {
    test(`${failure} 장애는 한 번의 실제 재시도 뒤 orphan 없이 수렴한다`, async ({
      authSeedPage,
    }) => {
      const controlPage = await authSeedPage('admin-confirmed');
      await resetProgramAuthoringControl(controlPage);
      const programId = await fixtureProgramId(controlPage);
      await expectApiStatus(
        await controlPage.request.post(`${controlPath}/failures`, {
          data: { failure, count: 1 },
        }),
        204,
      );

      const failed = await controlPage.request.post(`${controlPath}/exercise`, {
        data: { failure },
      });
      expect(failed.status()).toBeGreaterThanOrEqual(409);
      expect(failed.status()).toBeLessThan(600);
      await expectApiStatus(
        await controlPage.request.post(`${controlPath}/exercise`, {
          data: { failure },
        }),
        201,
      );

      const stateResponse = await controlPage.request.get(
        `${controlPath}/state/${encodeURIComponent(programId)}`,
      );
      await expectApiStatus(stateResponse, 200);
      const state = toStateCounts(await stateResponse.json());
      expect(state.orphanRows).toBe(0);
      expect(state.orphanObjects).toBe(0);
      await writeArtifact(`failures/${failure}.json`, {
        firstStatus: failed.status(),
        state,
      });
    });
  }

  test('생성 충돌은 기존 요청을 유지하고 추가 생성 없이 기존 프로그램으로 이동한다', async ({
    authSeedPage,
    programAuthoringActorPage,
  }, testInfo) => {
    test.setTimeout(90_000);
    const controlPage = await authSeedPage('admin-confirmed');
    const schedule = await resetProgramAuthoringControl(controlPage);
    await fixtureProgramId(controlPage);
    const authoringPath = '/api/v1/program-authoring/programs';
    const authorPage = await programAuthoringActorPage('staff', {
      status: 422,
      pathname: authoringPath,
    });
    const recoveryStorageKey = 'oss-hub:program-authoring:recovery-key';
    const requestKey = 'e2e-authoring-conflict-recovery';
    const dayMs = 24 * 60 * 60 * 1000;
    const applicationStart = seoulLocalInput(schedule, -dayMs);
    const applicationEnd = seoulLocalInput(schedule, 2 * dayMs);
    const operationEnd = seoulLocalInput(schedule, 10 * dayMs);
    const milestoneDate = seoulDeadlineDate(new Date(schedule));
    const toIso = (value: string) =>
      new Date(`${value}:00+09:00`).toISOString();
    const original = {
      name: '합성 생성 복구 프로그램',
      organizer: '합성 프로그램실',
      trackType: 'CURRICULAR',
      applicationStartAt: toIso(applicationStart),
      applicationEndAt: toIso(applicationEnd),
      startAt: toIso(applicationStart),
      endAt: toIso(operationEnd),
      teamMinSize: 1,
      teamMaxSize: 1,
      repositoryProvisioningEnabled: false,
      notifyOnDeadline: false,
      description: '같은 요청으로 이미 생성된 프로그램을 확인합니다.',
      milestones: [
        {
          name: '합성 안내 마일스톤',
          startAt: toIso(`${milestoneDate}T00:00`),
          dueAt: toIso(`${milestoneDate}T23:59`),
          instructions: null,
          documents: [],
        },
      ],
    };
    const createdResponse = await authorPage.request.post(authoringPath, {
      headers: { ...originHeaders(), 'Idempotency-Key': requestKey },
      data: original,
    });
    await expectApiStatus(createdResponse, 201);
    const created: unknown = await createdResponse.json();
    if (
      typeof created !== 'object' ||
      created === null ||
      !('id' in created) ||
      typeof created.id !== 'string'
    ) {
      throw new Error('Created program must have an ID.');
    }
    const existingProgramId = created.id;
    await authorPage.goto('/programs');
    await authorPage.evaluate(
      ({ key, value }) => sessionStorage.setItem(key, value),
      { key: recoveryStorageKey, value: requestKey },
    );
    const browserPosts: string[] = [];
    authorPage.on('request', (request) => {
      if (
        new URL(request.url()).pathname === authoringPath &&
        request.method() === 'POST'
      ) {
        browserPosts.push(request.headers()['idempotency-key'] ?? '');
      }
    });
    await authorPage.goto('/programs/new');
    await authorPage.getByLabel('프로그램명 *').fill(original.name);
    await authorPage.getByLabel('주관기관/학과 *').fill(original.organizer);
    await authorPage
      .getByLabel('교과/비교과 *')
      .selectOption('EXTRACURRICULAR');
    await authorPage.getByLabel('소개/설명 *').fill(original.description);
    await authorPage
      .locator('[data-slot="program-cover-field"] input[type="file"]')
      .setInputFiles(coverFile('recovery-poster.png'));
    await authorPage.getByRole('button', { name: '계속' }).click();
    await selectScheduleRange(authorPage, {
      rangeLabel: '신청 기간',
      startAt: applicationStart,
      endAt: applicationEnd,
    });
    await selectScheduleRange(authorPage, {
      rangeLabel: '운영 기간',
      startAt: applicationStart,
      endAt: operationEnd,
    });
    await authorPage.getByRole('button', { name: '계속' }).click();
    await authorPage.getByRole('button', { name: '마일스톤 추가' }).click();
    const milestoneDialog = authorPage.getByRole('dialog');
    await milestoneDialog.getByLabel('시작일').fill(milestoneDate);
    await milestoneDialog.getByLabel('마감일').fill(milestoneDate);
    await milestoneDialog
      .getByLabel('마일스톤 이름 *')
      .fill(original.milestones[0].name);
    await milestoneDialog.getByRole('button', { name: '저장' }).click();
    await authorPage.getByRole('button', { name: '계속' }).click();
    await authorPage.getByLabel('제출 마감 알림').uncheck();
    await authorPage.getByRole('button', { name: '계속' }).click();
    await authorPage.getByRole('button', { name: '프로그램 만들기' }).click();
    const [conflictResponse] = await Promise.all([
      authorPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === authoringPath &&
          response.request().method() === 'POST',
      ),
      authorPage.getByRole('button', { name: '생성 확정' }).click(),
    ]);
    expect(conflictResponse.request().postDataJSON()).toEqual({
      ...original,
      trackType: 'EXTRACURRICULAR',
      coverUploadId: expect.any(String),
    });
    expect(conflictResponse.status()).toBe(422);
    expect(await conflictResponse.json()).toMatchObject({
      code: 'PRG_017',
      existingProgramId,
    });
    const recoveryAction = authorPage.getByRole('button', {
      name: '기존 프로그램 확인',
      exact: true,
    });
    await expect(recoveryAction).toBeVisible();
    await expect(authorPage.getByRole('main').getByRole('alert')).toContainText(
      '작성 내용은 유지됩니다',
    );
    expect(
      await authorPage.evaluate(
        (key) => sessionStorage.getItem(key),
        recoveryStorageKey,
      ),
    ).toBe(requestKey);
    const viewports = [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ];
    for (const viewport of viewports) {
      await authorPage.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      await recoveryAction.scrollIntoViewIfNeeded();
      await expect(recoveryAction).toBeInViewport();
      expect(
        await authorPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBe(true);
      await authorPage.screenshot({
        path: testInfo.outputPath(`authoring-recovery-${viewport.name}.png`),
      });
    }
    expect(browserPosts).toEqual([requestKey]);
    const [cleanupResponse] = await Promise.all([
      authorPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname.startsWith(
            '/api/v1/program-authoring/uploads/',
          ) && response.request().method() === 'DELETE',
      ),
      recoveryAction.click(),
    ]);
    expect(cleanupResponse.status()).toBe(204);
    await expect(authorPage).toHaveURL(`/programs/${existingProgramId}`);
    await expect(
      authorPage.getByRole('heading', { name: original.name }),
    ).toBeVisible();
    expect(browserPosts).toEqual([requestKey]);
    expect(
      await authorPage.evaluate(
        (key) => sessionStorage.getItem(key),
        recoveryStorageKey,
      ),
    ).toBeNull();
    const existingResponse = await authorPage.request.get(
      `/api/v1/programs/${existingProgramId}`,
    );
    await expectApiStatus(existingResponse, 200);
    expect(await existingResponse.json()).toMatchObject({
      trackType: 'CURRICULAR',
    });
    await writeArtifact('authoring-recovery/conditions.json', {
      tool: 'Playwright Chrome',
      source:
        'Real isolated API and PostgreSQL with synthetic users and program; no HTTP route mocks',
      conflict: {
        status: 422,
        code: 'PRG_017',
        changedFields: ['trackType', 'coverUploadId'],
      },
      pendingCoverCleanupStatus: cleanupResponse.status(),
      existingProgramId,
      browserAuthoringPosts: browserPosts.length,
      viewports,
    });
  });

  test('반려 안내는 취소와 저장 실패를 보존하고 실제 재승인으로 복구된다', async ({
    authSeedPage,
    programAuthoringActorPage,
  }, testInfo) => {
    test.setTimeout(90_000);
    const controlPage = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(controlPage);
    const programId = await fixtureProgramId(controlPage);
    await expectApiStatus(
      await controlPage.request.post(`${controlPath}/applications`, {
        data: { mode: 'NEW' },
      }),
      201,
    );
    const listResponse = await controlPage.request.get(
      `/api/v1/programs/${encodeURIComponent(programId)}/applications?page=1&pageSize=20`,
    );
    await expectApiStatus(listResponse, 200);
    const { items } = (await listResponse.json()) as {
      items: { id: string }[];
    };
    expect(items).toHaveLength(1);
    expect(typeof items[0].id).toBe('string');
    const decisionPath = `/api/v1/applications/${encodeURIComponent(items[0].id)}`;
    const staffPage = await programAuthoringActorPage('staff', [
      { status: 503, pathname: decisionPath },
    ]);
    const decisions: string[] = [];
    staffPage.on('request', (request) => {
      if (
        new URL(request.url()).pathname === decisionPath &&
        request.method() === 'PATCH'
      ) {
        decisions.push(request.postData() ?? '');
      }
    });
    await staffPage.goto(`/programs/${encodeURIComponent(programId)}/teams`);

    const status = staffPage
      .getByRole('combobox', { name: '신청 상태' })
      .first();
    await expect(status).toHaveCount(1);
    const reviewUrl = staffPage.url();
    const dialog = staffPage.getByRole('alertdialog');
    for (const viewport of [
      { name: 'desktop', width: 1440, height: 900 },
      { name: 'mobile', width: 390, height: 844 },
    ]) {
      await staffPage.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });

      await status.selectOption('REJECTED');
      await expect(dialog).toBeVisible();

      await expect(dialog).not.toContainText('스스로 다시 신청할 수 없습니다');
      await expect(
        dialog.getByRole('textbox', { name: '반려 사유', exact: true }),
      ).toBeVisible();
      await dialog.screenshot({
        path: testInfo.outputPath(`rejection-${viewport.name}-element.png`),
      });
      await staffPage.screenshot({
        path: testInfo.outputPath(`rejection-${viewport.name}-viewport.png`),
      });
      await staffPage.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);

      await expect(status).toBeFocused();
      expect(decisions).toEqual([]);
    }
    const beforeResponse = await staffPage.request.get(decisionPath);
    await expectApiStatus(beforeResponse, 200);
    expect(await beforeResponse.json()).toMatchObject({ status: 'SUBMITTED' });

    await status.selectOption('REJECTED');
    const reason = dialog.getByRole('textbox', {
      name: '반려 사유',
      exact: true,
    });
    await reason.fill('합성 반려 사유');
    await staffPage.route(
      (url) => url.pathname === decisionPath,
      async (route) => {
        expect(route.request().method()).toBe('PATCH');
        await route.fulfill({
          status: 503,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: '합성 저장 장애',
            status: 503,
          }),
        });
      },
      { times: 1 },
    );
    await dialog
      .getByRole('button', { name: '반려 확정', exact: true })
      .click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(reason).toHaveValue('합성 반려 사유');
    expect(decisions).toHaveLength(1);
    const failedResponse = await staffPage.request.get(decisionPath);
    await expectApiStatus(failedResponse, 200);
    expect(await failedResponse.json()).toMatchObject({ status: 'SUBMITTED' });

    await dialog
      .getByRole('button', { name: '반려 확정', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(decisions).toHaveLength(2);
    const rejectedResponse = await staffPage.request.get(decisionPath);
    await expectApiStatus(rejectedResponse, 200);
    expect(await rejectedResponse.json()).toMatchObject({
      status: 'REJECTED',
      rejectionReason: '합성 반려 사유',
    });
    const studentPage = await programAuthoringActorPage('student');
    await studentPage.goto(`/programs/${encodeURIComponent(programId)}/apply`);
    await expect(
      studentPage.getByText('합성 반려 사유', { exact: true }),
    ).toBeVisible();

    await expect(
      studentPage.getByRole('button', { name: '수정 내용 저장' }),
    ).toHaveCount(0);

    await expect(
      studentPage.getByRole('button', { name: '신청 취소' }),
    ).toHaveCount(1);

    await staffPage.goto(reviewUrl);

    const approveStatus = staffPage
      .getByRole('combobox', { name: '신청 상태' })
      .first();
    await approveStatus.selectOption('APPROVED');
    await expect(dialog).toContainText('반려 사유는 지워집니다');
    await dialog
      .getByRole('button', { name: '승인 확정', exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    expect(decisions).toHaveLength(3);
    const approvedResponse = await staffPage.request.get(decisionPath);
    await expectApiStatus(approvedResponse, 200);
    expect(await approvedResponse.json()).toMatchObject({
      status: 'APPROVED',
      rejectionReason: null,
    });
    await writeArtifact('rejection-warning/conditions.json', {
      tool: 'Playwright Chrome',
      url: staffPage.url(),
      role: 'staff',
      viewports: [
        { width: 1440, height: 900 },
        { width: 390, height: 844 },
      ],
      syntheticFailure: { status: 503, requests: 1 },
      realDecisions: ['REJECTED', 'APPROVED'],
    });
  });

  test('cancelled application, inactive and opt-out recipients, stale preview, and cross-team files stay isolated', async ({
    authSeedPage,
    programAuthoringActorPage,
  }) => {
    const controlPage = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(controlPage);
    const programId = await fixtureProgramId(controlPage);
    const studentPage = await programAuthoringActorPage('student');
    const foreignPage = await programAuthoringActorPage('foreignStudent');

    await submitProgramApplication(foreignPage, programId);
    await foreignPage.goto(`/programs/${encodeURIComponent(programId)}/apply`);
    await foreignPage.waitForLoadState('networkidle');
    await foreignPage.getByRole('button', { name: '신청 취소' }).click();
    await foreignPage
      .getByRole('alertdialog', { name: '신청을 취소하시겠습니까?' })
      .getByRole('button', { name: '신청 취소' })
      .click();

    await expectApiStatus(
      await controlPage.request.post(`${controlPath}/applications`, {
        data: { mode: 'NEW' },
      }),
      201,
    );
    await expectApiStatus(
      await controlPage.request.post(`${controlPath}/approve-and-run`),
      201,
    );
    const eligiblePreview = await preview(controlPage);
    expect(eligiblePreview).toMatchObject({
      applicationCount: 1,
      milestoneCount: 1,
      recipientCount: 1,
      inactiveCount: 0,
      optedOutCount: 0,
      noEmailCount: 0,
    });
    await expectApiStatus(
      await studentPage.request.patch('/api/v1/users/me/notification-email', {
        headers: originHeaders(),
        data: {
          notificationEmail: 'student@e2e.invalid',
          notifyEnabled: false,
        },
      }),
      200,
    );
    const optedOutPreview = await preview(controlPage);
    expect(optedOutPreview).toMatchObject({
      applicationCount: 1,
      milestoneCount: 1,
      recipientCount: 0,
      inactiveCount: 0,
      optedOutCount: 1,
      noEmailCount: 0,
    });
    await expectApiStatus(
      await studentPage.request.patch('/api/v1/users/me/account/deactivate', {
        headers: originHeaders(),
      }),
      200,
    );
    const inactivePreview = await preview(controlPage);
    expect(inactivePreview).toMatchObject({
      applicationCount: 1,
      milestoneCount: 1,
      recipientCount: 0,
      inactiveCount: 1,
      optedOutCount: 0,
      noEmailCount: 0,
    });

    await expectApiStatus(
      await controlPage.request.patch(
        `/api/v1/users/${encodeURIComponent(studentUserId)}/access`,
        {
          headers: originHeaders(),
          data: {
            expectedRole: 'STUDENT',
            desiredRole: 'STUDENT',
            expectedAccountStatus: 'DEACTIVATED',
            desiredAccountStatus: 'ACTIVE',
            expectedPendingRequest: null,
          },
        },
      ),
      200,
    );
    await expectApiStatus(
      await controlPage.request.get(`${controlPath}/cross-team-current-file`),
      404,
    );

    await expectApiStatus(
      await controlPage.request.post(`${controlPath}/stale-preview`),
      409,
    );
    await expectApiStatus(
      await foreignPage.request.get(
        `/api/v1/milestones/${encodeURIComponent(milestoneId)}/documents/${encodeURIComponent(documentId)}/submissions/current/file`,
      ),
      404,
    );
    const stateResponse = await controlPage.request.get(
      `${controlPath}/state/${encodeURIComponent(programId)}`,
    );
    await expectApiStatus(stateResponse, 200);
    const state = toStateCounts(await stateResponse.json());

    const expectedMailEnvelopes = 1 + eligiblePreview.staffRecipientCount;
    expectCleanState(state, 1, 1, 2, expectedMailEnvelopes);
    await writeArtifact('failure-statuses.json', {
      eligiblePreview,
      inactivePreview,
      optedOutPreview,
      state,
    });
  });
});

async function preview(page: Page) {
  const response = await page.request.post(`${controlPath}/preview`);
  await expectApiStatus(response, 201);
  return parseDeadlinePreview(await response.json());
}
