import { expect, type Page, type TestInfo } from '@playwright/test';
import { assertKoreanWrapping } from './legacy-member-reclassification-accessibility';
import {
  armPathResponse,
  armReclassificationResponse,
  armSessionResponse,
  fillStaffReclassification,
  fillStudentReclassification,
} from './legacy-member-reclassification-actions';
import { installBrowserAudit } from './browser-audit';
import {
  type CapturedReclassification,
  installLegacyMemberReclassificationFixture,
  RECLASSIFICATION_PATH,
  TASK_10_BROWSER_TIMEOUT,
} from './legacy-member-reclassification-fixture';
import {
  captureLegacyReclassificationState,
  recordLegacyReclassificationAudit,
} from './legacy-member-reclassification-suite';

const studentRequest: CapturedReclassification = {
  memberKind: 'STUDENT',
  name: '합성 학생 관리자',
  studentId: '780001',
  affiliationKind: 'DEPARTMENT',
  affiliationName: '인공지능학부',
};

const staffRequest: CapturedReclassification = {
  memberKind: 'STAFF',
  name: '합성 교직원 관리자',
  affiliationKind: 'PROGRAM_OFFICE',
  affiliationName: '합성 SW중심대학사업단',
};

export async function runStudentSuccessAndReplay(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  const fixture = await installLegacyMemberReclassificationFixture(page);
  const audit = installBrowserAudit(page);
  await page.goto('/dashboard');
  const forced = page.locator('[data-slot="legacy-member-reclassification"]');
  await expect(forced).toBeVisible();
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-choice',
  );
  const choiceWrapping = await assertKoreanWrapping(
    forced.locator('[data-slot="card"]'),
    ['관리자 권한은'],
  );
  await fillStudentReclassification(page, studentRequest);
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-student',
  );

  const response = armReclassificationResponse(page, fixture, 200);
  const refreshedSession = armSessionResponse(page, fixture, 200);
  const dashboardResponse = armPathResponse(page, '/api/v1/dashboard/student');
  const removed = forced.waitFor({
    state: 'detached',
    timeout: TASK_10_BROWSER_TIMEOUT,
  });
  const settled = page.getByRole('heading', { name: '내 대시보드' }).waitFor({
    state: 'visible',
    timeout: TASK_10_BROWSER_TIMEOUT,
  });
  await page.getByRole('button', { name: '회원 유형 확인 완료' }).click();
  const [reclassification, session] = await Promise.all([
    response,
    refreshedSession,
    dashboardResponse,
    removed,
    settled,
  ]);
  expect(reclassification.status()).toBe(200);
  expect(session.status()).toBe(200);
  expect(fixture.attempts()).toEqual([studentRequest]);
  const settledHeaderWrapping = await assertKoreanWrapping(
    page.locator('[data-slot="page-header"]'),
    ['확인합니다'],
  );
  const settledEmptyWrapping = await assertKoreanWrapping(
    page.locator('[data-slot="empty-state"]'),
    ['첫 신청을'],
  );
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-student-settled',
  );

  const replayResponse = armReclassificationResponse(page, fixture, 200);
  const replayStatus = await page.evaluate(
    async ({ path, body }) => {
      const replay = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await replay.text();
      return replay.status;
    },
    { path: RECLASSIFICATION_PATH, body: studentRequest },
  );
  expect(replayStatus).toBe(200);
  expect((await replayResponse).status()).toBe(200);
  expect(fixture.replayCount()).toBe(1);
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-replay-settled',
  );

  recordLegacyReclassificationAudit('student-success-and-replay', audit, [], {
    responseStatuses: [200, 200],
    sessionRefreshStatus: 200,
    settledDashboardStatus: 200,
    forcedScreenRemoved: true,
    samePayloadReplay: true,
    koreanWrapping: {
      reclassificationCopy: choiceWrapping,
      settledHeader: settledHeaderWrapping,
      settledEmptyState: settledEmptyWrapping,
    },
  });
}

export async function runStaffSuccess(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  const fixture = await installLegacyMemberReclassificationFixture(page);
  const audit = installBrowserAudit(page);
  await page.goto('/dashboard');
  const forced = page.locator('[data-slot="legacy-member-reclassification"]');
  await expect(forced).toBeVisible();
  await fillStaffReclassification(page, staffRequest);
  await expect(page.getByLabel('학번')).toHaveCount(0);
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-staff-program-office',
  );

  const response = armReclassificationResponse(page, fixture, 200);
  const refreshedSession = armSessionResponse(page, fixture, 200);
  const dashboardResponse = armPathResponse(
    page,
    '/api/v1/dashboard/staff/summary',
  );
  const removed = forced.waitFor({
    state: 'detached',
    timeout: TASK_10_BROWSER_TIMEOUT,
  });
  const settled = page
    .getByRole('heading', { name: '운영 대시보드' })
    .waitFor({ state: 'visible', timeout: TASK_10_BROWSER_TIMEOUT });
  await page.getByRole('button', { name: '회원 유형 확인 완료' }).click();
  await Promise.all([
    response,
    refreshedSession,
    dashboardResponse,
    removed,
    settled,
  ]);
  expect(fixture.attempts()).toEqual([staffRequest]);
  expect('studentId' in fixture.attempts()[0]!).toBe(false);
  const settledHeaderWrapping = await assertKoreanWrapping(
    page.locator('[data-slot="page-header"]'),
    ['확인합니다'],
  );
  const settledEmptyWrapping = await assertKoreanWrapping(
    page.locator('[data-slot="empty-state"]'),
    ['표시됩니다'],
  );
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-staff-settled',
  );

  recordLegacyReclassificationAudit('staff-program-office-success', audit, [], {
    responseStatuses: [200],
    sessionRefreshStatus: 200,
    settledDashboardStatus: 200,
    forcedScreenRemoved: true,
    affiliationKind: 'PROGRAM_OFFICE',
    studentIdOmitted: true,
    koreanWrapping: {
      settledHeader: settledHeaderWrapping,
      settledEmptyState: settledEmptyWrapping,
    },
  });
}
