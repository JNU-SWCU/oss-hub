import { expect, type Page, type TestInfo } from '@playwright/test';
import {
  assertDestructiveAlertContrast,
  assertKoreanWrapping,
} from './legacy-member-reclassification-accessibility';
import { armReclassificationResponse } from './legacy-member-reclassification-actions';
import { installBrowserAudit } from './browser-audit';
import {
  installLegacyMemberReclassificationFixture,
  RECLASSIFICATION_PATH,
  TASK_10_BROWSER_TIMEOUT,
} from './legacy-member-reclassification-fixture';
import {
  captureLegacyReclassificationState,
  recordLegacyReclassificationAudit,
} from './legacy-member-reclassification-suite';

export async function runValidationAndFailures(
  page: Page,
  testInfo: TestInfo,
): Promise<void> {
  const fixture = await installLegacyMemberReclassificationFixture(page);
  const audit = installBrowserAudit(page);
  await page.goto('/dashboard');
  await page.getByLabel('회원 유형').selectOption('STUDENT');

  await page.getByRole('button', { name: '회원 유형 확인 완료' }).click();
  await expect(page.getByLabel('이름')).toBeFocused();
  expect(fixture.attempts()).toHaveLength(0);
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-empty-name-focus',
  );

  await page.getByLabel('이름').fill('합성 학생 관리자');
  await page.getByLabel('학번').fill('12');
  await page.getByRole('button', { name: '회원 유형 확인 완료' }).click();
  await expect(page.getByLabel('학번')).toBeFocused();
  expect(fixture.attempts()).toHaveLength(0);
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-invalid-student-id-focus',
  );

  await page.getByLabel('학번').fill('780002');
  await page.locator('#profile-department').selectOption('인공지능학부');
  fixture.setNextResult('malformed-success');
  const hold = fixture.holdNextReclassification();
  const request = page.waitForRequest(
    (candidate) =>
      candidate.method() === 'POST' &&
      new URL(candidate.url()).pathname === RECLASSIFICATION_PATH,
    { timeout: TASK_10_BROWSER_TIMEOUT },
  );
  const pendingResponse = armReclassificationResponse(page, fixture, 200);
  await page.getByRole('button', { name: '회원 유형 확인 완료' }).click();
  await request;
  const pendingButton = page.getByRole('button', { name: '저장 중…' });
  await expect(pendingButton).toBeDisabled();
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-pending-disabled',
  );
  hold.release();
  expect((await pendingResponse).status()).toBe(200);
  await expect(
    page.getByText('회원 유형을 저장하지 못했습니다. 다시 시도해 주세요.'),
  ).toBeVisible();
  const genericAlert = page.locator('[data-slot="alert"]');
  const genericContrast = await assertDestructiveAlertContrast(genericAlert);
  const genericWrapping = await assertKoreanWrapping(genericAlert, [
    '못했습니다',
  ]);
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-generic-api-error',
  );

  fixture.setNextResult('conflict');
  const conflictResponse = armReclassificationResponse(page, fixture, 409);
  await page.getByRole('button', { name: '회원 유형 확인 완료' }).click();
  expect((await conflictResponse).status()).toBe(409);
  await expect(
    page.getByText('이미 다른 회원 유형으로 저장되어 다시 변경할 수 없습니다.'),
  ).toBeVisible();
  const conflictAlert = page.locator('[data-slot="alert"]');
  const conflictContrast = await assertDestructiveAlertContrast(conflictAlert);
  const conflictWrapping = await assertKoreanWrapping(conflictAlert, [
    '못했습니다',
    '저장되어',
  ]);
  await captureLegacyReclassificationState(
    page,
    testInfo,
    'legacy-admin-conflict-409',
  );

  recordLegacyReclassificationAudit('validation-and-failures', audit, [409], {
    responseStatuses: [200, 409],
    emptySubmitRequests: 0,
    invalidSubmitRequests: 0,
    firstFocusSequence: ['name', 'studentId'],
    pendingButtonDisabled: true,
    genericApiErrorVisible: true,
    conflictVisible: true,
    destructiveContrast: {
      requiredMinimum: 4.5,
      generic: genericContrast,
      conflict: conflictContrast,
    },
    koreanWrapping: {
      generic: genericWrapping,
      conflict: conflictWrapping,
    },
  });
}
