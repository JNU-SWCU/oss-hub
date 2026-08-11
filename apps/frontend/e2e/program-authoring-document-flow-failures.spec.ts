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

  test('private OWN, inactive and opt-out recipients, stale preview, and cross-team files stay isolated', async ({
    authSeedPage,
    programAuthoringActorPage,
  }) => {
    const controlPage = await authSeedPage('admin-confirmed');
    await resetProgramAuthoringControl(controlPage);
    const programId = await fixtureProgramId(controlPage);
    const studentPage = await programAuthoringActorPage('student');
    const foreignPage = await programAuthoringActorPage('foreignStudent');

    await foreignPage.goto(`/programs/${encodeURIComponent(programId)}/apply`);
    await foreignPage.waitForLoadState('networkidle');
    await foreignPage.getByLabel('제목 *').fill('private OWN');
    await foreignPage
      .getByLabel('요약 *')
      .fill('공개가 아닌 저장소는 연결하지 않는다');
    await foreignPage
      .getByRole('radio', { name: '내 저장소 연결하기' })
      .check();
    await foreignPage
      .getByLabel('연결할 저장소 URL')
      .fill('https://github.com/e2e-org/owned-private');
    await foreignPage.getByLabel(/개인정보 수집·이용 동의/).check();
    await foreignPage.getByRole('button', { name: '신청 제출' }).click();
    await foreignPage.getByRole('button', { name: '신청서 제출' }).click();
    await expect(foreignPage.getByText('신청이 접수되었습니다')).toBeVisible();
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
    // 외국인 학생의 'private OWN' 신청은 취소되어 Application은 삭제됐지만
    // 그 신청이 만든 1인 팀은 Team.onDelete: Restrict로 남는다 — 여기 살아있는
    // 팀은 그 잔존 팀 1개 + 승인된 학생 본인 신청의 팀 1개, 총 2개다.
    expectCleanState(state, 1, 1, 2);
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
