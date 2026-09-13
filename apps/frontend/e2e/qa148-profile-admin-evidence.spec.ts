import { expect, test, type Route } from '@playwright/test';

import { installBrowserAudit } from './support/browser-audit';
import {
  captureBothViewports,
  captureEvidenceRegion,
  capturePhase,
  EVIDENCE_VIEWPORTS,
  expectByPhase,
  fulfillJson,
  installExactApiRouter,
  type Qa148ApiHandlers,
} from './support/qa148-evidence';

/**
 * QA148 profile/admin visual evidence. Intercepted `/api/v1/**` bodies are UI-only
 * arrangements: they are not persisted onboarding, settings, admin-directory, or
 * audit proof. Real student/staff onboarding success belongs to
 * `auth-member-access` (M05 / 10-OnboardingMigration).
 */
test.use({ locale: 'ko-KR', timezoneId: 'Asia/Seoul' });

type EvidenceScene =
  'role' | 'settings' | 'admin-users' | 'admin-audit' | 'consent';

type SelectedRole = 'STUDENT' | 'STAFF';

const UNASSIGNED_SESSION = {
  isAuthenticated: true,
  user: {
    nickname: 'synthetic-qa148-unassigned',
    name: '합성 미배정',
    email: null,
    avatarUrl: null,
    memberKind: null,
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: false,
  },
} as const;

const STUDENT_SESSION = {
  isAuthenticated: true,
  user: {
    nickname: 'synthetic-qa148-student',
    name: '합성 학생',
    email: null,
    avatarUrl: null,
    memberKind: 'STUDENT',
    hasStaffAccess: false,
    hasAdminAccess: false,
    isProfileComplete: true,
  },
} as const;

const ADMIN_SESSION = {
  isAuthenticated: true,
  user: {
    nickname: 'synthetic-admin-self',
    name: '합성 관리자',
    email: null,
    avatarUrl: null,
    memberKind: 'STAFF',
    hasStaffAccess: true,
    hasAdminAccess: true,
    isProfileComplete: true,
  },
} as const;

const INCOMPLETE_PROFILE = {
  name: '',
  studentId: null,
  department: null,
  phone: null,
  isComplete: false,
} as const;

const SETTINGS_PROFILE = {
  name: '합성 학생',
  studentId: '260901',
  department: '인공지능학부',
  phone: '1'.repeat(10),
  isComplete: true,
} as const;

const SETTINGS_NOTIFICATION = {
  notificationEmail: null,
  notifyEnabled: false,
} as const;

const ADMIN_CREATED_AT = '2026-03-02T00:00:00.000Z';

const ADMIN_USERS_PAGE = {
  items: [
    {
      id: 'synthetic-admin-self',
      githubLogin: 'synthetic-admin-self',
      name: '합성 관리자',
      role: 'ADMIN',
      accountStatus: 'ACTIVE',
      isSelf: true,
      isProfileComplete: true,
      createdAt: ADMIN_CREATED_AT,
      pendingRequest: null,
      lastLoginAt: null,
    },
  ],
  page: 1,
  limit: 20,
  total: 1,
  facets: {
    roles: { unassigned: 0, student: 0, staff: 0, admin: 1 },
    accountStatuses: { active: 1, deactivated: 0 },
    pendingRequests: { none: 1, pending: 0 },
  },
} as const;

const PHONE_AUDIT_PAGE = {
  items: [
    {
      id: 'audit-user-phone-replaced',
      actor: 'synthetic-admin-self',
      actorHandle: 'synthetic-admin-self',
      action: 'USER_PHONE_UPDATED',
      targetType: 'USER',
      targetId: 'user-synthetic-phone',
      target: 'synthetic-target-login',
      targetHandle: 'synthetic-target-login',
      occurredAt: ADMIN_CREATED_AT,
      legacy: false,
      metadata: { schemaVersion: 1, transition: 'REPLACED' },
    },
  ],
  total: 1,
  page: 1,
  limit: 20,
} as const;

const CONSENT_CURRENT = {
  policyVersion: '2026-08-11',
  requiredItems: [
    {
      key: 'PRIVACY',
      label: '개인정보 수집·이용',
      documentUrl: '/policies/privacy/2026-08-11.html',
    },
  ],
  consented: false,
  nextUrl: '/onboarding/role',
} as const;

const CONSENT_PROFILE_PROBLEM = {
  type: 'about:blank',
  title: 'Synthetic consent required',
  status: 422,
  detail: 'Synthetic policy acceptance is required.',
  instance: '/api/v1/users/me/profile',
  code: 'CON_003',
} as const;

function sessionHandlers(body: unknown): Qa148ApiHandlers {
  return {
    'GET /api/v1/auth/session': (route: Route) => fulfillJson(route, body),
  };
}

function unassignedOnboardingHandlers(
  selectedRole: SelectedRole | null,
): Qa148ApiHandlers {
  return {
    'GET /api/v1/role-requests/me': (route: Route) => fulfillJson(route, null),
    'GET /api/v1/onboarding/role': (route: Route) =>
      fulfillJson(route, { selectedRole }),
  };
}

async function fulfillConsentProfile(route: Route): Promise<void> {
  await route.fulfill({
    status: 422,
    contentType: 'application/problem+json',
    body: JSON.stringify(CONSENT_PROFILE_PROBLEM),
  });
}

test('captures QA148 before or after evidence for profile and admin surfaces', async ({
  page,
}, testInfo) => {
  const phase = capturePhase();
  const browserAudit = installBrowserAudit(page);

  let scene: EvidenceScene = 'role';
  let selectedRole: SelectedRole | null = null;

  await installExactApiRouter(page, () => {
    const postRole: Qa148ApiHandlers = {
      'POST /api/v1/onboarding/role': async (route: Route) => {
        const body = route.request().postDataJSON() as {
          readonly selectedRole?: unknown;
        };
        if (body.selectedRole !== 'STUDENT' && body.selectedRole !== 'STAFF') {
          throw new Error(
            `Unexpected intercepted API request: POST /api/v1/onboarding/role`,
          );
        }
        selectedRole = body.selectedRole;
        await fulfillJson(route, {
          selectedRole,
          redirectTo: '/onboarding/profile',
        });
      },
    };

    switch (scene) {
      case 'role':
        return {
          ...sessionHandlers(UNASSIGNED_SESSION),
          ...unassignedOnboardingHandlers(selectedRole),
          ...postRole,
          'GET /api/v1/users/me/profile': (route: Route) =>
            fulfillJson(route, INCOMPLETE_PROFILE),
        };
      case 'settings':
        return {
          ...sessionHandlers(STUDENT_SESSION),
          'GET /api/v1/users/me/profile': (route: Route) =>
            fulfillJson(route, SETTINGS_PROFILE),
          'GET /api/v1/users/me/notification-email': (route: Route) =>
            fulfillJson(route, SETTINGS_NOTIFICATION),
          'GET /api/v1/team-invitations/received': (route: Route) =>
            fulfillJson(route, []),
        };
      case 'admin-users':
        return {
          ...sessionHandlers(ADMIN_SESSION),
          'GET /api/v1/users/access': (route: Route) =>
            fulfillJson(route, ADMIN_USERS_PAGE),
        };
      case 'admin-audit':
        return {
          ...sessionHandlers(ADMIN_SESSION),
          'GET /api/v1/audit-logs': (route: Route) =>
            fulfillJson(route, PHONE_AUDIT_PAGE),
        };
      case 'consent':
        return {
          ...sessionHandlers(UNASSIGNED_SESSION),
          ...unassignedOnboardingHandlers(null),
          'GET /api/v1/users/me/profile': fulfillConsentProfile,
          'GET /api/v1/consents/current': (route: Route) =>
            fulfillJson(route, CONSENT_CURRENT),
        };
      default: {
        const exhaustive: never = scene;
        return exhaustive;
      }
    }
  });

  await page.goto('/onboarding/role');
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
  const profileForm = page.locator('form').filter({
    has: page.getByRole('group', { name: '기본 정보', exact: true }),
  });
  await captureBothViewports({
    page,
    testInfo,
    phase,
    name: 'student-profile',
    target: profileForm,
    masks: [profileForm.locator('input'), profileForm.locator('select')],
  });

  selectedRole = null;
  await page.goto('/onboarding/role');
  await page.locator('label[data-role="STAFF"]').click();
  await page.getByRole('button', { name: '선택 완료' }).click();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
  await expect(page.locator('#profile-phone')).toHaveCount(0);

  scene = 'settings';
  await page.goto('/settings');
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
  scene = 'admin-users';
  await page.goto('/dashboard/users');
  const usersTable = page.getByRole('region', { name: '사용자 목록 표' });
  await expectByPhase(usersTable.getByText(/가입 일시/).first(), phase);
  const adminUserRow = usersTable
    .getByRole('row')
    .filter({ hasText: '@synthetic-admin-self' });
  await expect(adminUserRow).toContainText('2026. 3. 2. 오전 9:00');
  await captureBothViewports({
    page,
    testInfo,
    phase,
    name: 'admin-users-header',
    target: usersTable,
  });

  scene = 'admin-audit';
  await page.goto('/dashboard/audit-logs');
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
  scene = 'consent';
  selectedRole = null;
  await page.setViewportSize(EVIDENCE_VIEWPORTS[0]);
  await page.goto('/onboarding/role');
  const consentDialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', {
      name: '개인정보·활동 동의가 필요합니다',
    }),
  });
  await expect(consentDialog).toBeVisible();
  await expect(
    consentDialog
      .getByRole('button', { name: /개인정보 수집·이용 전문 보기/ })
      .first(),
  ).toBeVisible();
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
  const policyFrame = page.frameLocator(
    'iframe[title="개인정보 수집·이용 전문"]',
  );
  await expect(
    policyFrame.getByRole('heading', { name: '개인정보 수집·이용' }),
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
  await expect(
    policyFrame.getByRole('heading', { name: '개인정보 수집·이용' }),
  ).toBeVisible();
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
      url: '',
    },
    {
      text: `Blocked script execution in '${origin}/policies/privacy/2026-08-11.html' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.`,
      url: `${origin}/policies/privacy/2026-08-11.html`,
    },
    {
      text: `Blocked script execution in '${origin}/policies/privacy/2026-08-11.html' because the document's frame is sandboxed and the 'allow-scripts' permission is not set.`,
      url: '',
    },
  ]);
  expect(consentPageErrors).toEqual([]);
});
