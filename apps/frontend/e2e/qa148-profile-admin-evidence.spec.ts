import { expect, test } from './admin-session.fixture';
import { installBrowserAudit } from './support/browser-audit';
import {
  activateRoute,
  captureBothViewports,
  captureEvidenceRegion,
  capturePhase,
  EVIDENCE_VIEWPORTS,
  expectByPhase,
} from './support/qa148-evidence';

test('captures QA148 before or after evidence for profile and admin surfaces', async ({
  page,
}, testInfo) => {
  const phase = capturePhase();
  const browserAudit = installBrowserAudit(page);

  await activateRoute(page, {
    fixture: 'unassigned',
    path: '/onboarding/role',
  });
  const roleSelection = page
    .getByRole('heading', { name: '어떤 역할로 쓰시나요' })
    .locator('..');
  await expect(page.getByText('기타(직접 입력)', { exact: true })).toHaveCount(
    0,
  );
  await captureBothViewports({
    page,
    testInfo,
    phase,
    name: 'role-onboarding',
    target: roleSelection,
  });

  await page.locator('label[data-role="STUDENT"]').click();
  await page.getByRole('button', { name: '선택 완료' }).click();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  await expectByPhase(page.getByLabel('전화번호'), phase);
  const profileForm = page.locator('form').filter({ hasText: '신원 정보' });
  await captureBothViewports({
    page,
    testInfo,
    phase,
    name: 'student-profile',
    target: profileForm,
    masks: [profileForm.locator('input'), profileForm.locator('select')],
  });

  await activateRoute(page, {
    fixture: 'settings',
    path: '/settings',
  });
  await expectByPhase(page.getByLabel('전화번호'), phase);
  const settingsProfile = page
    .getByRole('group')
    .filter({ hasText: '프로필' })
    .first();
  await captureBothViewports({
    page,
    testInfo,
    phase,
    name: 'settings-profile',
    target: settingsProfile,
    masks: [
      settingsProfile.locator('input'),
      settingsProfile.locator('select'),
    ],
  });

  await page.setViewportSize(EVIDENCE_VIEWPORTS[0]);
  await activateRoute(page, {
    fixture: 'admin',
    path: '/dashboard/users',
  });
  const usersTable = page.getByRole('region', { name: '사용자 목록 표' });
  await expectByPhase(usersTable.getByText(/가입 일시/).first(), phase);
  await captureBothViewports({
    page,
    testInfo,
    phase,
    name: 'admin-users-header',
    target: usersTable,
  });

  await activateRoute(page, {
    fixture: 'admin',
    path: '/dashboard/audit-logs',
  });
  const auditTable = page.getByRole('region', { name: '감사 로그 표' });
  const phoneUpdateRow = auditTable
    .getByRole('row')
    .filter({ hasText: '전화번호를 변경했습니다' })
    .first();
  await expect(phoneUpdateRow).toContainText('전화번호 수정');
  await captureBothViewports({
    page,
    testInfo,
    phase,
    name: 'admin-audit-header',
    target: auditTable,
  });
  await captureBothViewports({
    page,
    testInfo,
    phase,
    name: 'admin-audit-phone-update',
    target: phoneUpdateRow.getByRole('cell').last(),
  });

  browserAudit.assertClean();
  const origin = new URL(page.url()).origin;
  const consentConsoleErrors: Array<{
    readonly text: string;
    readonly url: string;
  }> = [];
  const consentPageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') {
      consentConsoleErrors.push({
        text: message.text(),
        url: message.location().url,
      });
    }
  });
  page.on('pageerror', (error) => consentPageErrors.push(error.message));
  await page.route('**/api/v1/users/me/profile', async (route) => {
    await route.fulfill({
      status: 422,
      contentType: 'application/problem+json',
      body: JSON.stringify({
        type: 'about:blank',
        title: 'Synthetic consent required',
        status: 422,
        detail: 'Synthetic policy acceptance is required.',
        instance: '/api/v1/users/me/profile',
        code: 'CON_003',
      }),
    });
  });
  await page.setViewportSize(EVIDENCE_VIEWPORTS[0]);
  await activateRoute(page, {
    fixture: 'unassigned',
    path: '/onboarding/role',
  });
  const consentDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', {
      name: '개인정보·활동 동의가 필요합니다',
    }),
  });
  await expect(consentDialog).toBeVisible();
  await captureBothViewports({
    page,
    testInfo,
    phase,
    name: 'consent-required',
    target: consentDialog,
  });

  await page.setViewportSize(EVIDENCE_VIEWPORTS[0]);
  await page.keyboard.press('Escape');
  await expect(consentDialog).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/role$/);
  await page.locator('[data-slot="dialog-overlay"]').click({
    position: { x: 1, y: 1 },
    force: true,
  });
  await expect(consentDialog).toBeVisible();
  await expect(page).toHaveURL(/\/onboarding\/role$/);

  await consentDialog
    .getByRole('button', { name: /개인정보 수집·이용 전문 보기/ })
    .click();
  const policyDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: '개인정보 수집·이용 전문' }),
  });
  await expect(policyDialog).toBeVisible();
  await expect(
    policyDialog.getByTitle('개인정보 수집·이용 전문'),
  ).toBeVisible();
  await captureEvidenceRegion({
    page,
    testInfo,
    phase,
    name: 'consent-policy-dialog',
    target: policyDialog,
    viewport: EVIDENCE_VIEWPORTS[0],
  });
  await policyDialog.getByRole('button', { name: '전문 닫기' }).click();
  await page.setViewportSize(EVIDENCE_VIEWPORTS[1]);
  await consentDialog
    .getByRole('button', { name: /개인정보 수집·이용 전문 보기/ })
    .click();
  await expect(policyDialog).toBeVisible();
  await captureEvidenceRegion({
    page,
    testInfo,
    phase,
    name: 'consent-policy-dialog',
    target: policyDialog,
    viewport: EVIDENCE_VIEWPORTS[1],
  });
  await expect(page).toHaveURL(/\/onboarding\/role$/);

  const consentAuditReceipt = {
    consoleErrors: consentConsoleErrors,
    pageErrors: consentPageErrors,
  };
  await testInfo.attach('qa148-browser-audit', {
    body: Buffer.from(JSON.stringify(consentAuditReceipt, null, 2)),
    contentType: 'application/json',
  });
  expect(consentConsoleErrors).toEqual([
    {
      text: 'Failed to load resource: the server responded with a status of 422 (Unprocessable Entity)',
      url: `${origin}/api/v1/users/me/profile`,
    },
    {
      text: `Blocked script execution in '${origin}/policies/privacy/2026-08-11.html' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.`,
      url: `${origin}/policies/privacy/2026-08-11.html`,
    },
    {
      text: `Blocked script execution in '${origin}/policies/privacy/2026-08-11.html' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.`,
      url: `${origin}/policies/privacy/2026-08-11.html`,
    },
  ]);
  expect(consentPageErrors).toEqual([]);
});
