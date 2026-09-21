import type { Page } from '@playwright/test';
import { expect, test } from './admin-session.fixture';
import {
  expectApiStatus,
  expectCleanState,
  parseDeadlinePreview,
  PROGRAM_AUTHORING_E2E,
  toStateCounts,
  writeArtifact,
} from './support/program-authoring-flow';
import {
  fixtureProgramId,
  originHeaders,
  resetProgramAuthoringControl,
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
    const { items } = await listResponse.json();
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
    /*
     * 「참여 팀」과 「신청자」가 「팀 관리」 하나로 합쳐지면서 판정 입구가 바뀌었다 —
     * 상세로 들어가는 「검토하기」 링크가 아니라 목록 행의 상태 드롭다운이다.
     */
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
      // 창은 상태를 고르는 순간 열린다 — 드롭다운은 Enter 로 열리지 않는다.
      await status.selectOption('REJECTED');
      await expect(dialog).toBeVisible();
      /*
       * 「스스로 다시 신청할 수 없습니다」는 반려 재제출이 열리면서 **거짓이 됐다**.
       * 남은 계약은 사유가 필수라는 것과, 검토 대기를 거치는 것처럼 말하지 않는
       * 것이다.
       */
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
      // 창을 연 컨트롤로 초점이 돌아와야 키보드만 쓰는 사람이 자리를 잃지 않는다.
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
    /*
     * 반려는 더 이상 종착점이 아니다 — 학생은 막히지 않고 신청 화면을 그대로 본다.
     * 다만 이 픽스처의 양식은 자동 항목(`applicantName`) 하나뿐이라 **고칠 것이
     * 없고**, 그래서 저장 버튼도 서지 않는다. 눌러도 바뀔 것이 없는 컨트롤을 두지
     * 않는 쪽이 맞다. 고칠 항목이 있는 양식의 재제출은 단위 테스트가 건다.
     */
    await expect(
      studentPage.getByRole('button', { name: '수정 내용 저장' }),
    ).toHaveCount(0);
    // 막힌 화면이 아니라는 것 — 신청 취소가 살아 있다.
    await expect(
      studentPage.getByRole('button', { name: '신청 취소' }),
    ).toHaveCount(1);

    await staffPage.goto(reviewUrl);
    /*
     * 반려된 신청을 승인으로 되돌리는 것은 「처음 승인」과 결과가 다르다 — 남아 있는
     * 반려 사유가 지워진다. 그래서 이 경로만 확인 창을 거친다.
     */
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

    // cross-team-current-file은 ensureCurrentFile()에서 이 학생의 유일한
    // 필수 서류를 실제로 제출시킨다 — deadline eligibility가 "미제출 서류
    // 존재"로 자격을 판정하므로, 세 preview(eligible/optedOut/inactive)가
    // 전부 끝난 뒤에만 호출해야 이 응용의 applicationCount를 보존한다.
    // 다만 서류 제출은 서비스 계층에서 제출자 accountStatus ACTIVE를 요구해
    // (findActiveUser) 방금 비활성화한 계정으로는 실패하므로, 실제 ADMIN
    // HTTP 세션으로 계정을 되돌린 뒤 호출한다.
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
    // 외국인 학생의 신청은 취소되어 Application은 삭제됐지만
    // 그 신청이 만든 1인 팀은 Team.onDelete: Restrict로 남는다 — 여기 살아있는
    // 팀은 그 잔존 팀 1개 + 승인된 학생 본인 신청의 팀 1개, 총 2개다.
    // The fake sender records one envelope per recipient. Other tests may opt
    // staff out, so compare with the actual preview while fixing student count.
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
