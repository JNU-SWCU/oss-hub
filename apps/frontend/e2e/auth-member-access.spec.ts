import type { Browser, Page, Route, TestInfo } from '@playwright/test';

import { expect, test } from './admin-session.fixture';
import { e2eEnvironment } from './environment';
import { installBrowserAudit } from './support/browser-audit';
import {
  fulfillJson,
  installSyntheticAuthority,
  type MemberAccessApiHandlers,
  type SyntheticAuthority,
} from './support/member-access-fixture';
import {
  assertTabSequence,
  captureResponsiveMenu,
  captureResponsivePage,
  captureTask9State,
  TASK_9_VIEWPORTS,
} from './support/member-access-visual';
import {
  UNIONED_MENU_CASES,
  type MenuCase,
} from './support/member-access-menu-cases';
import { seedId } from './support/session-cookie';

const EMPTY_ACTIVITY_TIMELINE = {
  dataAsOf: null,
  programs: [],
  series: { granularity: 'MONTH', points: [] },
} as const;

const EMPTY_STAFF_INSIGHTS = {
  scope: { kind: 'all' },
  dataAsOf: null,
  years: [],
  cohorts: [],
  departments: [],
  programs: [],
} as const;

const EMPTY_STAFF_SUMMARY = { programs: [] } as const;

const EMPTY_ADMIN_DIRECTORY = {
  items: [],
  page: 1,
  limit: 20,
  total: 0,
  facets: {
    roles: { unassigned: 0, student: 0, staff: 0, admin: 0 },
    accountStatuses: { active: 0, deactivated: 0 },
    pendingRequests: { none: 0, pending: 0 },
  },
} as const;

const INCOMPLETE_PROFILE = {
  name: '합성 가입 사용자',
  studentId: null,
  department: null,
  phone: null,
  isComplete: false,
} as const;

const COMPLETE_STAFF_PROFILE = {
  name: '합성 권한 사용자',
  studentId: null,
  department: '합성 사업단',
  phone: null,
  isComplete: true,
} as const;

function jsonHandler(body: unknown) {
  return async (route: Route): Promise<void> => {
    await fulfillJson(route, body);
  };
}

function studentMenuReads(): MemberAccessApiHandlers {
  return {
    'GET /api/v1/dashboard/student/activity-timeline': jsonHandler(
      EMPTY_ACTIVITY_TIMELINE,
    ),
    'GET /api/v1/team-invitations/received': jsonHandler([]),
  };
}

function staffMenuReads(): MemberAccessApiHandlers {
  return {
    'GET /api/v1/dashboard/staff/insights': jsonHandler(EMPTY_STAFF_INSIGHTS),
    'GET /api/v1/dashboard/staff/summary': jsonHandler(EMPTY_STAFF_SUMMARY),
  };
}

function adminDirectoryReads(): MemberAccessApiHandlers {
  return {
    'GET /api/v1/users/access': jsonHandler(EMPTY_ADMIN_DIRECTORY),
  };
}

function menuReadsFor(authority: SyntheticAuthority): MemberAccessApiHandlers {
  return {
    ...(authority.memberKind === 'STUDENT'
      ? {
          ...studentMenuReads(),
          'GET /api/v1/dashboard/student': jsonHandler({ items: [] }),
          'GET /api/v1/users/me/notifications/application-decisions':
            jsonHandler([]),
        }
      : {}),
    ...(authority.hasStaffAccess ? staffMenuReads() : {}),
    ...(authority.hasAdminAccess ? adminDirectoryReads() : {}),
  };
}

async function installUnassignedMenuDenial(
  page: Page,
  kind: 'NONE' | 'REVOKED',
): Promise<void> {
  const settled = kind === 'REVOKED';
  await installSyntheticAuthority(
    page,
    {
      role: null,
      memberKind: settled ? 'STAFF' : null,
      hasStaffAccess: false,
      hasAdminAccess: false,
      isProfileComplete: settled,
    },
    {
      'GET /api/v1/role-requests/me': jsonHandler(
        settled
          ? {
              requestedRole: 'STAFF',
              status: 'REVOKED',
              requestedAt: '2026-08-20T00:00:00.000Z',
              decidedAt: '2026-08-21T00:00:00.000Z',
              rejectionReason: null,
            }
          : null,
      ),
      'GET /api/v1/onboarding/role': jsonHandler({ selectedRole: null }),
      'GET /api/v1/users/me/profile': jsonHandler(
        settled ? COMPLETE_STAFF_PROFILE : INCOMPLETE_PROFILE,
      ),
    },
  );
}

async function chooseMemberKind(
  page: Page,
  kind: 'STUDENT' | 'STAFF',
): Promise<void> {
  const radio = page.getByRole('radio', {
    name: kind === 'STUDENT' ? '학생' : '교직원',
  });
  await page.locator(`label[data-role="${kind}"]`).click();
  await expect(radio).toBeChecked();
  await page.getByRole('button', { name: '선택 완료' }).click();
  await expect(page).toHaveURL(/\/onboarding\/profile$/);
}

async function readPersistedOnboarding(page: Page): Promise<{
  readonly session: unknown;
  readonly profile: unknown;
  readonly selection: unknown;
  readonly staffRequestBody: string;
}> {
  const [session, profile, selection, staffRequest] = await Promise.all([
    page.request.get('/api/v1/auth/session'),
    page.request.get('/api/v1/users/me/profile'),
    page.request.get('/api/v1/onboarding/role'),
    page.request.get('/api/v1/role-requests/me'),
  ]);
  expect(session.ok(), `session ${session.status()}`).toBe(true);
  expect(profile.ok(), `profile ${profile.status()}`).toBe(true);
  expect(selection.ok(), `selection ${selection.status()}`).toBe(true);
  expect(staffRequest.ok(), `staff request ${staffRequest.status()}`).toBe(
    true,
  );
  return {
    session: await session.json(),
    profile: await profile.json(),
    selection: await selection.json(),
    staffRequestBody: await staffRequest.text(),
  };
}

async function captureMenuCase(
  browser: Browser,
  scenario: MenuCase,
  testInfo: TestInfo,
): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const audit = installBrowserAudit(page);
  try {
    await installSyntheticAuthority(
      page,
      scenario.authority,
      menuReadsFor(scenario.authority),
    );
    await page.goto(scenario.path);
    for (const label of scenario.visible) {
      await expect(
        page.getByText(label, { exact: true }).first(),
      ).toBeVisible();
    }
    for (const label of scenario.hidden) {
      await expect(page.getByText(label, { exact: true })).toHaveCount(0);
    }
    if (scenario.name.startsWith('student-staff-')) {
      await assertStudentStaffDestinations(page, scenario.path);
    }
    await captureResponsiveMenu(page, testInfo, `menu-${scenario.name}`);
    audit.assertClean();
  } finally {
    await context.close();
  }
}

function studentStaffLink(page: Page, label: '내 대시보드' | '운영 대시보드') {
  return page
    .locator('[data-slot="app-sidebar-nav"]')
    .getByRole('link', { name: label, exact: true });
}

async function assertStudentStaffDestinations(
  page: Page,
  path: string,
): Promise<void> {
  const personal = studentStaffLink(page, '내 대시보드');
  const operating = studentStaffLink(page, '운영 대시보드');
  await expect(personal).toHaveAttribute('href', '/dashboard/personal');
  await expect(operating).toHaveAttribute('href', '/dashboard');
  if (path === '/dashboard/personal') {
    await expect(personal).toHaveAttribute('aria-current', 'page');
    await expect(operating).not.toHaveAttribute('aria-current', 'page');
    return;
  }
  await expect(operating).toHaveAttribute('aria-current', 'page');
  await expect(personal).not.toHaveAttribute('aria-current', 'page');
}

async function captureStudentStaffCompactHeader(
  browser: Browser,
  testInfo: TestInfo,
): Promise<void> {
  const authority: SyntheticAuthority = {
    role: 'STUDENT',
    memberKind: 'STUDENT',
    hasStaffAccess: true,
    hasAdminAccess: false,
  };
  const context = await browser.newContext();
  const page = await context.newPage();
  const audit = installBrowserAudit(page);
  try {
    await installSyntheticAuthority(page, authority, menuReadsFor(authority));
    await page.goto('/dashboard/personal');
    const accountMenu = page.getByRole('button', {
      name: 'synthetic-member-access 계정 메뉴, 학생 · 교직원',
    });
    for (const viewport of TASK_9_VIEWPORTS) {
      await page.setViewportSize(viewport);
      const summary = page.getByLabel('학생 · 교직원 권한');
      if (viewport.name === 'narrow') {
        await expect(summary).toBeVisible();
        await expect(summary).toHaveText('권한 2개');
        await expect(
          page.getByLabel('학생 권한', { exact: true }),
        ).toBeHidden();
        await expect(
          page.getByLabel('교직원 권한', { exact: true }),
        ).toBeHidden();
      } else {
        await expect(summary).toBeHidden();
        await expect(
          page.getByLabel('학생 권한', { exact: true }),
        ).toBeVisible();
        await expect(
          page.getByLabel('교직원 권한', { exact: true }),
        ).toBeVisible();
      }
      await accountMenu.click();
      const menu = page.getByRole('menu', { name: '계정 메뉴' });
      await expect(menu).toBeVisible();
      await expect(
        menu.getByText('학생 · 교직원', { exact: true }),
      ).toBeVisible();
      await captureTask9State(
        page,
        testInfo,
        'account-student-staff',
        viewport,
      );
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
    }
    audit.assertClean();
  } finally {
    await context.close();
  }
}

test('student onboarding completes with affiliation and conditional student ID', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('student-onboarding-unassigned');
  const audit = installBrowserAudit(page);
  await page.goto('/onboarding/role');
  await assertTabSequence(
    page,
    page.getByRole('radio', { name: '학생' }),
    page.getByRole('radio', { name: '교직원' }),
    'ArrowRight',
  );
  await captureResponsivePage(page, testInfo, 'student-member-selection');
  await chooseMemberKind(page, 'STUDENT');
  await page.getByLabel('이름').fill('합성 학생 회원');
  await page.getByLabel('학번').fill('260901');
  await page.getByLabel('전화번호').fill('1'.repeat(10));
  await page.locator('#profile-department').selectOption('인공지능학부');
  await assertTabSequence(
    page,
    page.getByLabel('이름'),
    page.getByLabel('학번'),
  );
  await captureResponsivePage(page, testInfo, 'student-onboarding-affiliation');
  await page.getByRole('button', { name: '가입 마치기' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole('heading', { name: '내 대시보드' }),
  ).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByRole('heading', { name: '내 대시보드' }),
  ).toBeVisible();
  const persisted = await readPersistedOnboarding(page);
  expect(persisted.session).toMatchObject({
    isAuthenticated: true,
    user: {
      name: '합성 학생 회원',
      memberKind: 'STUDENT',
      hasStaffAccess: false,
      hasAdminAccess: false,
      isProfileComplete: true,
    },
  });
  expect(persisted.profile).toEqual({
    name: '합성 학생 회원',
    studentId: '260901',
    department: '인공지능학부',
    phone: '1'.repeat(10),
    isComplete: true,
  });
  expect(persisted.selection).toEqual({ selectedRole: 'STUDENT' });
  expect(persisted.staffRequestBody).toBe('');
  const dashboard = await page.request.get('/api/v1/dashboard/student');
  expect(dashboard.ok(), `dashboard ${dashboard.status()}`).toBe(true);
  expect(await dashboard.json()).toEqual({ items: [] });
  audit.assertClean();
});

test('staff onboarding omits student ID and reaches pending approval', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('staff-onboarding-unassigned');
  const audit = installBrowserAudit(page);
  await page.goto('/onboarding/role');
  await captureResponsivePage(page, testInfo, 'staff-member-selection');
  await chooseMemberKind(page, 'STAFF');
  await page.getByLabel('이름').fill('합성 교직원 회원');
  await page.getByLabel('소속 유형').selectOption('PROGRAM_OFFICE');
  await page
    .getByLabel('사업단', { exact: false })
    .fill('합성 SW중심대학사업단');
  await expect(page.getByLabel('학번')).toHaveCount(0);
  await captureResponsivePage(page, testInfo, 'staff-onboarding-affiliation');
  await page.getByRole('button', { name: '가입 마치기' }).click();
  await expect(page).toHaveURL(/\/onboarding\/pending$/);
  await expect(
    page.getByRole('heading', { name: /교직원 승인을/ }),
  ).toBeVisible();
  await captureResponsivePage(page, testInfo, 'staff-onboarding-pending');

  await page.reload();
  await expect(page).toHaveURL(/\/onboarding\/pending$/);
  await expect(
    page.getByRole('heading', { name: /교직원 승인을/ }),
  ).toBeVisible();
  const persisted = await readPersistedOnboarding(page);
  expect(persisted.session).toMatchObject({
    isAuthenticated: true,
    user: {
      name: '합성 교직원 회원',
      memberKind: 'STAFF',
      hasStaffAccess: false,
      hasAdminAccess: false,
      isProfileComplete: true,
    },
  });
  expect(persisted.profile).toEqual({
    name: '합성 교직원 회원',
    studentId: null,
    department: '합성 SW중심대학사업단',
    phone: null,
    isComplete: true,
  });
  expect(persisted.selection).toEqual({ selectedRole: 'STAFF' });
  expect(JSON.parse(persisted.staffRequestBody)).toMatchObject({
    requestedRole: 'STAFF',
    status: 'PENDING',
    decidedAt: null,
    rejectionReason: null,
  });
  audit.assertClean();
});

test('unioned menus cover student, staff, student-admin, staff-admin, student-staff, and admin-only', async ({
  browser,
  page,
  adminPage,
}, testInfo) => {
  for (const scenario of UNIONED_MENU_CASES) {
    await captureMenuCase(browser, scenario, testInfo);
  }
  await captureStudentStaffCompactHeader(browser, testInfo);

  const adminOnlyAudit = installBrowserAudit(page);
  const adminOnlyPostRequests: string[] = [];
  page.on('request', (request) => {
    if (request.method() === 'POST') {
      adminOnlyPostRequests.push(new URL(request.url()).pathname);
    }
  });
  await installSyntheticAuthority(
    page,
    {
      role: 'ADMIN',
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: true,
    },
    adminDirectoryReads(),
  );
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/dashboard\/users$/);
  await expect(page.locator('[data-slot="nav-bar"]')).toBeVisible();
  await captureResponsiveMenu(page, testInfo, 'menu-admin-only');
  expect(adminOnlyPostRequests).toEqual([]);
  adminOnlyAudit.assertClean();

  const adminAudit = installBrowserAudit(adminPage);
  await adminPage.goto(
    `/dashboard/users/${encodeURIComponent(seedId('auth', 'admin-second'))}`,
  );
  await expect(
    adminPage.getByLabel('교직원 접근', { exact: true }),
  ).toBeVisible();
  await expect(
    adminPage.getByLabel('관리자 접근', { exact: true }),
  ).toBeVisible();
  await captureResponsivePage(adminPage, testInfo, 'admin-only-controls');
  await adminPage.goto(
    `/dashboard/users/${encodeURIComponent(seedId('auth', 'staff-revocable'))}`,
  );
  await expect(
    adminPage.getByLabel('교직원 접근', { exact: true }),
  ).toBeVisible();
  await expect(
    adminPage.getByLabel('관리자 접근', { exact: true }),
  ).toBeVisible();
  // 계정 상태도 같은 드롭다운 규격이다 — 지금 값이 선택돼 있고 후행 상태가
  // 목록에 이름으로 서 있다.
  const accountStatus = adminPage.getByLabel('계정 상태', { exact: true });
  await expect(accountStatus).toHaveValue('ACTIVE');
  await accountStatus.focus();
  await expect(accountStatus).toBeFocused();
  await captureResponsivePage(adminPage, testInfo, 'staff-only-controls');
  adminAudit.assertClean();
});

test('direct URL denial removes admin surfaces and backend denies staff', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('staff-revocable');
  const audit = installBrowserAudit(page);
  await page.goto('/dashboard/users');
  await expect(
    page.getByRole('heading', { name: '접근 권한이 없습니다' }),
  ).toBeVisible();
  await expect(page.getByText('사용자 목록', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: '내 화면으로 돌아가기' }).focus();
  await expect(
    page.getByRole('link', { name: '내 화면으로 돌아가기' }),
  ).toBeFocused();
  await captureResponsivePage(page, testInfo, 'direct-url-denied');
  const response = await page.request.get(
    `${e2eEnvironment.baseUrl}/api/v1/users/access`,
  );
  expect(response.status()).toBe(403);
  audit.assertClean();
});

test('mixed student-staff seed reaches personal dashboard with distinct destinations', async ({
  authSeedPage,
}, testInfo) => {
  // Failed Chrome oracle (staff-o-c57bd): this persona is not staff-only.
  // staff-revocable has a studentId, so the public session is STUDENT +
  // hasStaffAccess and /dashboard/personal already renders.
  const page = await authSeedPage('staff-revocable');
  const audit = installBrowserAudit(page);
  const session = await page.request.get('/api/v1/auth/session');
  expect(session.ok(), `session ${session.status()}`).toBe(true);
  expect(await session.json()).toMatchObject({
    isAuthenticated: true,
    user: {
      nickname: 'seed-auth-staff-revocable',
      memberKind: 'STUDENT',
      hasStaffAccess: true,
      hasAdminAccess: false,
      isProfileComplete: true,
    },
  });
  await page.goto('/dashboard/personal');
  await expect(page).toHaveURL(/\/dashboard\/personal$/);
  await expect(
    page.getByRole('heading', { name: '내 대시보드' }),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: '접근 권한이 없습니다' }),
  ).toHaveCount(0);
  await assertStudentStaffDestinations(page, '/dashboard/personal');
  await captureResponsivePage(
    page,
    testInfo,
    'personal-dashboard-mixed-accepted',
  );
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    const header = page.locator('[data-slot="nav-bar"]');
    await expect(header).toBeVisible();
    if (viewport.name === 'mobile') {
      await expect(page.getByLabel('학생 · 교직원 권한')).toHaveText(
        '권한 2개',
      );
    }
    await header.screenshot({
      path: testInfo.outputPath(`mixed-role-${viewport.name}-header.png`),
    });
    await page.screenshot({
      path: testInfo.outputPath(`mixed-role-${viewport.name}-viewport.png`),
    });
  }
  audit.assertClean();
});

test('non-student admin is denied on the personal dashboard route', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('admin-confirmed');
  const audit = installBrowserAudit(page);
  const session = await page.request.get('/api/v1/auth/session');
  expect(session.ok(), `session ${session.status()}`).toBe(true);
  expect(await session.json()).toMatchObject({
    isAuthenticated: true,
    user: {
      nickname: 'seed-auth-admin-confirmed',
      memberKind: 'STAFF',
      hasStaffAccess: false,
      hasAdminAccess: true,
      isProfileComplete: true,
    },
  });
  await page.goto('/dashboard/personal');
  await expect(page).toHaveURL(/\/dashboard\/personal$/);
  await expect(
    page.getByRole('heading', { name: '접근 권한이 없습니다' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '내 대시보드' })).toHaveCount(
    0,
  );
  await captureResponsivePage(
    page,
    testInfo,
    'personal-dashboard-admin-denied',
  );
  audit.assertClean();
});

test('rejected staff returns to member selection with the rejection reason', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('staff-rejected');
  const audit = installBrowserAudit(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/onboarding\/role$/);
  await expect(page.getByText('교직원 요청이 반려되었습니다')).toBeVisible();
  await captureResponsivePage(page, testInfo, 'staff-rejected');
  audit.assertClean();
});

test('revoked staff is unassigned and has no staff surface', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  await installUnassignedMenuDenial(page, 'NONE');
  await page.goto('/dashboard/insights');
  await expect(page).toHaveURL(/\/onboarding\/role$/);
  await captureResponsivePage(page, testInfo, 'member-unassigned');
  audit.assertClean();

  const revokedPage = await page.context().newPage();
  const revokedAudit = installBrowserAudit(revokedPage);
  await installUnassignedMenuDenial(revokedPage, 'REVOKED');
  await revokedPage.goto('/dashboard/insights');
  await expect(revokedPage).toHaveURL(/\/onboarding\/role$/);
  await expect(
    revokedPage.getByText('운영 대시보드', { exact: true }),
  ).toHaveCount(0);
  await captureResponsivePage(revokedPage, testInfo, 'staff-revoked');
  revokedAudit.assertClean();
  await revokedPage.close();
});

test('deactivated session is denied by the backend and shown as logged out', async ({
  authSeedPage,
}, testInfo) => {
  const page = await authSeedPage('staff-revoked');
  const audit = installBrowserAudit(page);
  await page.goto('/dashboard');
  await expect(page.getByText(/로그인이 필요/)).toBeVisible();
  await captureResponsivePage(page, testInfo, 'deactivated-session');
  const session = await page.request.get(
    `${e2eEnvironment.baseUrl}/api/v1/auth/session`,
  );
  expect(await session.json()).toEqual({ isAuthenticated: false });
  const denied = await page.request.get(
    `${e2eEnvironment.baseUrl}/api/v1/users/access`,
  );
  expect(denied.status()).toBe(401);
  audit.assertClean();
});
