import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test';

import { adminAccessMutationSuccessMessage } from '../src/features/roles/access-administration/admin-access-mutation-policy';
import {
  SYNTHETIC_SELF,
  adminUserHistoryFor,
  adminUsersDetailById,
  adminUsersListPage,
  adminUsersPage1Rows,
  type SyntheticAdminUserDetail,
  type SyntheticAdminUserRow,
  type SyntheticMemberKind,
  type SyntheticRole,
} from './support/admin-users-fixture';
import { installBrowserAudit } from './support/browser-audit';
import {
  fulfillJson,
  installSyntheticAuthority,
  type MemberAccessApiHandlers,
} from './support/member-access-fixture';

const ADMIN_SESSION = {
  role: 'ADMIN',
  memberKind: 'STAFF',
  hasStaffAccess: true,
  hasAdminAccess: true,
} as const;
const CONFLICT_NOTICE =
  '다른 처리자가 먼저 변경했습니다. 최신 정보로 갱신했으니 다시 확인한 뒤 진행해 주세요.';
const PENDING_REQUEST_REASON = '대기 중인 요청을 먼저 처리해 주세요.';
const LG_BREAKPOINT = 1024;
const DESKTOP = { width: 1440, height: 900 } as const;
const MOBILE = { width: 390, height: 844 } as const;
const LAYOUT_WIDTHS = [2560, 1440, 1280, 1024, 390] as const;
const MAX_MOBILE_ROW_HEIGHT = 320;
const HIDE_DEV_OVERLAY = 'nextjs-portal { display: none !important; }';
const TABLE_CONTAINER = 'section > div.overflow-hidden.rounded-lg';
const CAPTURE_DIR = process.env.CAPTURE_EVIDENCE_DIR;
const CAPTURE_PREFIX = process.env.CAPTURE_PREFIX ?? 'after';

test.use({ locale: 'ko-KR', timezoneId: 'Asia/Seoul', colorScheme: 'light' });

interface Problem {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly detail: string;
  readonly instance: string;
  readonly code: string;
}

function problem(
  status: number,
  detail: string,
  instance: string,
  code: string,
): Problem {
  return {
    type: 'about:blank',
    title: '합성 오류',
    status,
    detail,
    instance,
    code,
  };
}

type PatchKind = 'member-kind' | 'admin-access' | 'access';
const PATCH_KINDS: readonly PatchKind[] = [
  'member-kind',
  'admin-access',
  'access',
];

interface PatchRecord {
  readonly path: string;
  readonly body: Record<string, unknown>;
}

interface AdminUsersStore {
  rows: readonly SyntheticAdminUserRow[];
  readonly details: Record<string, SyntheticAdminUserDetail>;
  detailGets: number;
  readonly patches: PatchRecord[];
  failNextListGetWith: Problem | null;
  failNextPatchWith: {
    readonly problem: Problem;
    readonly changeServerStateBeforeReply?: () => void;
  } | null;
  readonly includeAuthorityFields: boolean;
}

function createStore(includeAuthorityFields = true): AdminUsersStore {
  return {
    rows: adminUsersPage1Rows,
    details: Object.fromEntries(
      adminUsersPage1Rows.map((row) => [row.id, adminUsersDetailById[row.id]]),
    ),
    detailGets: 0,
    patches: [],
    failNextListGetWith: null,
    failNextPatchWith: null,
    includeAuthorityFields,
  };
}

function changeOnServerAfterListLoaded(
  store: AdminUsersStore,
  id: string,
  change: Partial<SyntheticAdminUserRow>,
): void {
  store.rows = store.rows.map((row) =>
    row.id === id ? { ...row, ...change } : row,
  );
  store.details[id] = { ...store.details[id], ...change };
}

function legacyRow(row: SyntheticAdminUserRow) {
  return {
    id: row.id,
    githubLogin: row.githubLogin,
    name: row.name,
    role: row.role,
    accountStatus: row.accountStatus,
    isSelf: row.isSelf,
    isProfileComplete: row.isProfileComplete,
    createdAt: row.createdAt,
    pendingRequest: row.pendingRequest,
    lastLoginAt: row.lastLoginAt,
  };
}

function roleOf(
  memberKind: SyntheticMemberKind | null,
  hasStaffAccess: boolean,
  hasAdminAccess: boolean,
): SyntheticRole | null {
  if (hasAdminAccess) return 'ADMIN';
  if (hasStaffAccess) return 'STAFF';
  return memberKind === 'STUDENT' ? 'STUDENT' : null;
}

function applyPatch(
  row: SyntheticAdminUserRow,
  kind: PatchKind,
  body: Record<string, unknown>,
): SyntheticAdminUserRow {
  if (kind === 'member-kind') {
    const memberKind = body.memberKind;
    if (memberKind !== 'STUDENT' && memberKind !== 'STAFF') {
      throw new TypeError(`unexpected memberKind: ${String(memberKind)}`);
    }
    const hasStaffAccess = memberKind === 'STAFF';
    const hasAdminAccess = hasStaffAccess && row.hasAdminAccess;
    return {
      ...row,
      memberKind,
      hasStaffAccess,
      hasAdminAccess,
      role: roleOf(memberKind, hasStaffAccess, hasAdminAccess),
    };
  }
  if (kind === 'admin-access') {
    const hasAdminAccess = body.command === 'GRANT_ADMIN_ACCESS';
    return {
      ...row,
      hasAdminAccess,
      role: roleOf(row.memberKind, row.hasStaffAccess, hasAdminAccess),
    };
  }
  const accountStatus = body.desiredAccountStatus;
  if (accountStatus !== 'ACTIVE' && accountStatus !== 'DEACTIVATED') {
    throw new TypeError(`unexpected accountStatus: ${String(accountStatus)}`);
  }
  return { ...row, accountStatus };
}

function postJson(route: Route): Record<string, unknown> {
  const data: unknown = route.request().postDataJSON();
  if (typeof data !== 'object' || data === null) {
    throw new TypeError('PATCH body must be a JSON object');
  }
  return data as Record<string, unknown>;
}

async function handlePatch(
  store: AdminUsersStore,
  id: string,
  kind: PatchKind,
  route: Route,
): Promise<void> {
  const body = postJson(route);
  store.patches.push({ path: new URL(route.request().url()).pathname, body });
  const failure = store.failNextPatchWith;
  if (failure) {
    store.failNextPatchWith = null;
    failure.changeServerStateBeforeReply?.();
    await fulfillJson(route, failure.problem, failure.problem.status);
    return;
  }
  const current = store.rows.find((row) => row.id === id);
  if (!current) throw new Error(`unknown synthetic user: ${id}`);
  const next = applyPatch(current, kind, body);
  store.rows = store.rows.map((row) => (row.id === id ? next : row));
  store.details[id] = { ...store.details[id], ...next };
  await fulfillJson(
    route,
    kind === 'access'
      ? {
          id,
          role: next.role,
          accountStatus: next.accountStatus,
          pendingRequest: next.pendingRequest,
          decidedRequest: null,
        }
      : {
          id,
          role: next.role,
          memberKind: next.memberKind,
          hasStaffAccess: next.hasStaffAccess,
          hasAdminAccess: next.hasAdminAccess,
        },
  );
}

function adminUsersHandlers(store: AdminUsersStore): MemberAccessApiHandlers {
  const handlers: Record<string, (route: Route) => Promise<void>> = {
    'GET /api/v1/users/access': async (route) => {
      const failure = store.failNextListGetWith;
      if (failure) {
        store.failNextListGetWith = null;
        await fulfillJson(route, failure, failure.status);
        return;
      }
      await fulfillJson(route, {
        ...adminUsersListPage,
        items: store.includeAuthorityFields
          ? store.rows
          : store.rows.map(legacyRow),
      });
    },
    'GET /api/v1/users/access/requests': async (route) => {
      const items = store.rows.filter((row) => row.pendingRequest !== null);
      await fulfillJson(route, {
        ...adminUsersListPage,
        items,
        total: items.length,
      });
    },
  };
  for (const row of adminUsersPage1Rows) {
    const base = `/api/v1/users/${encodeURIComponent(row.id)}`;
    handlers[`GET ${base}/access`] = async (route) => {
      store.detailGets += 1;
      await fulfillJson(route, store.details[row.id]);
    };
    handlers[`GET ${base}/access/history`] = async (route) =>
      fulfillJson(route, adminUserHistoryFor(row));
    for (const kind of PATCH_KINDS) {
      handlers[`PATCH ${base}/${kind}`] = async (route) =>
        handlePatch(store, row.id, kind, route);
    }
  }
  return handlers;
}

function panel(page: Page): Locator {
  return page.locator('[data-slot="role-panel-shell"]');
}

function tableRegion(page: Page): Locator {
  return page.getByRole('region', { name: '사용자 목록 표' });
}

function rowOf(page: Page, name: string): Locator {
  return page
    .getByRole('row')
    .filter({ has: page.getByRole('link', { name, exact: true }) });
}

function cellControl(page: Page, name: string, control: string): Locator {
  return page.getByRole('combobox', {
    name: `${name} ${control}`,
    exact: true,
  });
}

function dialogNamed(page: Page, title: string): Locator {
  return page.getByRole('dialog', { name: title, exact: true });
}

async function choose(trigger: Locator, option: string): Promise<void> {
  await trigger.click();
  await trigger
    .page()
    .getByRole('option', { name: option, exact: true })
    .click();
}

async function refreshAfterClick(control: Locator): Promise<void> {
  const refreshed = control
    .page()
    .waitForResponse(
      (response) =>
        new URL(response.url()).pathname === '/api/v1/users/access' &&
        response.request().method() === 'GET',
    );
  await control.click();
  await refreshed;
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.getByText('사용자 목록을 불러오는 중…')).toHaveCount(0);
}

function scrollTopOf(page: Page): Promise<number> {
  return page.evaluate(
    () => document.getElementById('main-content')?.scrollTop ?? window.scrollY,
  );
}

function contentHeight(page: Page): Promise<number> {
  return page.evaluate(() => {
    const main = document.getElementById('main-content');
    if (!main) throw new Error('#main-content missing');
    return Math.ceil(main.scrollHeight - main.clientHeight);
  });
}

async function openDirectory(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
  store = createStore(),
): Promise<AdminUsersStore> {
  await installSyntheticAuthority(
    page,
    ADMIN_SESSION,
    adminUsersHandlers(store),
  );
  await page.setViewportSize(viewport);
  await page.goto('/dashboard/users');
  await page.addStyleTag({ content: HIDE_DEV_OVERLAY });
  await expect(
    page.getByRole('heading', { name: '사용자 목록', exact: true }),
  ).toBeVisible();
  await settle(page);
  await expect(tableRegion(page)).toContainText('합성 사용자 19');
  return store;
}

test('행에서 학생을 교직원으로 바꾸면 확인 후 PATCH 하고 목록을 조용히 갱신한다 (1280px)', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);
  const store = await openDirectory(page, { width: 1280, height: 900 });
  const trigger = cellControl(page, '합성 사용자 01', '회원 유형');
  await expect(trigger).toHaveText('학생');
  const scrollTop = await scrollTopOf(page);

  await choose(trigger, '교직원');
  const dialog = dialogNamed(page, '교직원으로 변경');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('교직원 접근 권한이 부여됩니다.');
  expect(store.detailGets).toBe(1);
  expect(store.patches).toEqual([]);
  await refreshAfterClick(
    dialog.getByRole('button', { name: '변경', exact: true }),
  );
  await expect(dialog).toBeHidden();

  expect(store.patches).toEqual([
    {
      path: '/api/v1/users/synthetic-id-01/member-kind',
      body: {
        memberKind: 'STAFF',
        expectedMemberKind: 'STUDENT',
        expectedHasStaffAccess: false,
        staffNumber: null,
      },
    },
  ]);
  await expect(trigger).toHaveText('교직원');
  await expect(panel(page).getByRole('status')).toHaveText(
    adminAccessMutationSuccessMessage('SET_MEMBER_STAFF', 'synthetic-user-01'),
  );
  await expect(page.getByText('사용자 목록을 불러오는 중…')).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/users$/);
  await expect(dialogNamed(page, '사용자 목록 상세')).toHaveCount(0);
  expect(await scrollTopOf(page)).toBe(scrollTop);
  await expect(trigger).toBeFocused();
  audit.assertClean();
});

test('교직원을 학생으로 바꿀 때 저장된 학과는 읽기 전용이고 학번만 입력한다 (1440px)', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);
  const store = createStore();
  const staff = store.details['synthetic-id-04'];
  store.details['synthetic-id-04'] = {
    ...staff,
    profile: {
      ...staff.profile,
      studentId: null,
      department: '소프트웨어공학과',
    },
  };
  await openDirectory(page, DESKTOP, store);
  const trigger = cellControl(page, '합성 사용자 04', '회원 유형');
  await expect(trigger).toHaveText('교직원');

  await choose(trigger, '학생');
  const dialog = dialogNamed(page, '학생으로 변경');
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText('소프트웨어공학과', { exact: true }),
  ).toBeVisible();
  await expect(dialog.getByText('저장된 학과를 사용합니다.')).toBeVisible();
  await expect(dialog.locator('#admin-member-kind-department')).toHaveCount(0);
  await dialog.locator('#admin-member-kind-student-id').fill('123456');
  await refreshAfterClick(
    dialog.getByRole('button', { name: '변경', exact: true }),
  );
  await expect(dialog).toBeHidden();

  expect(store.patches).toEqual([
    {
      path: '/api/v1/users/synthetic-id-04/member-kind',
      body: {
        memberKind: 'STUDENT',
        expectedMemberKind: 'STAFF',
        expectedHasStaffAccess: true,
        studentId: '123456',
        department: '소프트웨어공학과',
      },
    },
  ]);
  await expect(trigger).toHaveText('학생');
  await expect(panel(page).getByRole('status')).toHaveText(
    adminAccessMutationSuccessMessage(
      'SET_MEMBER_STUDENT',
      'synthetic-user-04',
    ),
  );
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(/\/dashboard\/users$/);
  audit.assertClean();
});

for (const width of [MOBILE.width, 1280] as const) {
  test(`15번째 행을 바꾸면 알림이 화면 안에 보이고 스크롤과 포커스가 유지된다 (${width}px)`, async ({
    page,
  }) => {
    const audit = installBrowserAudit(page);
    const store = await openDirectory(page, {
      width,
      height: width === MOBILE.width ? MOBILE.height : DESKTOP.height,
    });
    const row = rowOf(page, '합성 사용자 14');
    const trigger =
      width >= LG_BREAKPOINT
        ? cellControl(page, '합성 사용자 14', '계정 상태')
        : row.getByRole('combobox', { name: '계정 상태', exact: true });
    await trigger.evaluate((element) =>
      element.scrollIntoView({ block: 'center' }),
    );
    const scrollTop = await scrollTopOf(page);
    expect(scrollTop).toBeGreaterThan(0);

    await choose(trigger, '비활성');
    const dialog = dialogNamed(page, '계정 비활성화');
    await expect(dialog).toBeVisible();
    await refreshAfterClick(
      dialog.getByRole('button', { name: '비활성화 확정' }),
    );
    await expect(dialog).toBeHidden();

    const notice = panel(page).getByRole('status');
    await expect(notice).toHaveText(
      adminAccessMutationSuccessMessage(
        'SET_STATUS_DEACTIVATED',
        'synthetic-user-14',
      ),
    );
    await expect(notice).toBeInViewport();
    await expect(trigger).toHaveText('비활성');
    await expect(trigger).toBeInViewport();
    await expect(trigger).toBeFocused();
    expect(await scrollTopOf(page)).toBeGreaterThanOrEqual(scrollTop);
    expect(store.patches).toEqual([
      {
        path: '/api/v1/users/synthetic-id-14/access',
        body: {
          expectedRole: 'STUDENT',
          desiredRole: 'STUDENT',
          expectedAccountStatus: 'ACTIVE',
          desiredAccountStatus: 'DEACTIVATED',
          expectedPendingRequest: null,
        },
      },
    ]);
    await expect(page).toHaveURL(/\/dashboard\/users$/);
    audit.assertClean();
  });
}

test('조용한 갱신이 실패하면 오류 알림이 sticky 영역에 보이고 다시 시도는 전체 재조회다 (1280px)', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);
  const store = await openDirectory(page, { width: 1280, height: 900 });
  const trigger = cellControl(page, '합성 사용자 14', '계정 상태');
  await trigger.evaluate((element) =>
    element.scrollIntoView({ block: 'center' }),
  );
  expect(await scrollTopOf(page)).toBeGreaterThan(0);

  await choose(trigger, '비활성');
  const dialog = dialogNamed(page, '계정 비활성화');
  await expect(dialog).toBeVisible();
  const failureDetail = '목록을 다시 불러오지 못했습니다.';
  store.failNextListGetWith = problem(
    500,
    failureDetail,
    '/api/v1/users/access',
    'SYS_001',
  );
  await dialog.getByRole('button', { name: '비활성화 확정' }).click();
  await expect(dialog).toBeHidden();

  const alert = panel(page)
    .getByRole('alert')
    .filter({ hasText: failureDetail });
  await expect(alert).toBeVisible();
  await expect(alert).toBeInViewport();
  const retry = alert.getByRole('button', { name: '다시 시도' });
  await expect(retry).toBeInViewport();
  await expect(trigger).toHaveText('활성');
  await expect(trigger).toBeInViewport();
  expect(store.patches).toHaveLength(1);

  await refreshAfterClick(retry);
  await expect(alert).toBeHidden();
  await expect(cellControl(page, '합성 사용자 14', '계정 상태')).toHaveText(
    '비활성',
  );
  audit.assertClean([
    { status: 500, path: '/api/v1/users/access', method: 'GET' },
  ]);
});

test('드롭다운을 열고 닫아도 상세가 열리지 않고 드롭다운 밖 행 클릭은 상세 오버레이를 연다 (1280px)', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);
  const store = await openDirectory(page, { width: 1280, height: 900 });
  const trigger = cellControl(page, '합성 사용자 03', '회원 유형');
  await trigger.click();
  await expect(page.getByRole('listbox')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await expect(page).toHaveURL(/\/dashboard\/users$/);
  await expect(dialogNamed(page, '사용자 목록 상세')).toHaveCount(0);

  await rowOf(page, '합성 사용자 03').getByRole('cell').nth(4).click();
  const overlay = dialogNamed(page, '사용자 목록 상세');
  await expect(overlay).toBeVisible();
  await expect(page).toHaveURL(/\/dashboard\/users\/synthetic-id-03$/);
  await expect(overlay).toContainText('합성 사용자 03');
  await overlay.getByRole('button', { name: '닫기' }).click();
  await expect(overlay).toBeHidden();
  await expect(page).toHaveURL(/\/dashboard\/users$/);
  expect(store.patches).toEqual([]);
  audit.assertClean();
});

test('자기 행과 대기 요청 행은 막힌 선택지를 비활성으로 보여 주고 사유를 툴팁으로 알린다 (1280px)', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);
  const store = await openDirectory(page, { width: 1280, height: 900 });

  await cellControl(page, SYNTHETIC_SELF.name, '계정 상태').click();
  await expect(
    page.getByRole('option', { name: '비활성', exact: true }),
  ).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);
  await cellControl(page, SYNTHETIC_SELF.name, '관리자 접근').click();
  await expect(
    page.getByRole('option', { name: '비허용', exact: true }),
  ).toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('listbox')).toHaveCount(0);

  const pendingKind = cellControl(page, '합성 사용자 05', '회원 유형');
  await expect(pendingKind).toBeDisabled();
  const pendingReason = page.getByRole('tooltip', {
    name: PENDING_REQUEST_REASON,
    exact: true,
  });
  await pendingKind.hover();
  await expect(pendingReason).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pendingReason).toBeHidden();
  await pendingKind.locator('xpath=..').focus();
  await expect(pendingReason).toBeVisible();

  expect(store.detailGets).toBe(0);
  expect(store.patches).toEqual([]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  audit.assertClean();
});

test('409 응답은 충돌 알림을 띄우고 목록을 다시 조회한다 (1280px)', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);
  const store = await openDirectory(page, { width: 1280, height: 900 });
  const trigger = cellControl(page, '합성 사용자 03', '회원 유형');
  await choose(trigger, '교직원');
  const dialog = dialogNamed(page, '교직원으로 변경');
  await expect(dialog).toBeVisible();
  store.failNextPatchWith = {
    problem: problem(
      409,
      '다른 처리자가 회원 유형을 먼저 변경했습니다.',
      '/api/v1/users/synthetic-id-03/member-kind',
      'ROL_014',
    ),
  };
  await refreshAfterClick(
    dialog.getByRole('button', { name: '변경', exact: true }),
  );

  const conflict = panel(page)
    .getByRole('alert')
    .filter({ hasText: CONFLICT_NOTICE });
  await expect(conflict).toBeVisible();
  await expect(dialog).toBeHidden();
  expect(store.patches).toHaveLength(1);
  await expect(trigger).toHaveText('학생');
  await expect(trigger).toBeFocused();
  audit.assertClean([
    {
      status: 409,
      path: '/api/v1/users/synthetic-id-03/member-kind',
      method: 'PATCH',
    },
  ]);
});

test('500 응답은 다이얼로그 안에 서버 문구를 보이고 그 사이 바뀐 서버 값이 목록에 반영된다 (1280px)', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);
  const store = await openDirectory(page, { width: 1280, height: 900 });
  const trigger = cellControl(page, '합성 사용자 06', '계정 상태');
  await choose(trigger, '비활성');
  const dialog = dialogNamed(page, '계정 비활성화');
  await expect(dialog).toBeVisible();
  const detail = '합성 서버 오류로 계정 상태를 변경하지 못했습니다.';
  store.failNextPatchWith = {
    problem: problem(
      500,
      detail,
      '/api/v1/users/synthetic-id-06/access',
      'SYS_001',
    ),
    changeServerStateBeforeReply: () =>
      changeOnServerAfterListLoaded(store, 'synthetic-id-10', {
        accountStatus: 'DEACTIVATED',
      }),
  };
  await refreshAfterClick(
    dialog.getByRole('button', { name: '비활성화 확정' }),
  );

  await expect(dialog.getByRole('alert')).toHaveText(detail);
  await expect(dialog).toBeVisible();
  await expect(
    page.locator('#admin-access-row-synthetic-id-10-access-status-control'),
  ).toHaveText('비활성');
  await expect(
    page.locator('#admin-access-row-synthetic-id-06-access-status-control'),
  ).toHaveText('활성');
  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  expect(store.patches).toHaveLength(1);
  audit.assertClean([
    {
      status: 500,
      path: '/api/v1/users/synthetic-id-06/access',
      method: 'PATCH',
    },
  ]);
});

test('사전 조회 값이 행과 다르면 PATCH 없이 충돌 알림만 띄운다 (1280px)', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);
  const store = await openDirectory(page, { width: 1280, height: 900 });
  const trigger = cellControl(page, '합성 사용자 13', '계정 상태');
  await expect(trigger).toHaveText('활성');
  changeOnServerAfterListLoaded(store, 'synthetic-id-13', {
    accountStatus: 'DEACTIVATED',
  });
  await trigger.click();
  await refreshAfterClick(
    page.getByRole('option', { name: '비활성', exact: true }),
  );
  await expect(
    panel(page).getByRole('alert').filter({ hasText: CONFLICT_NOTICE }),
  ).toBeVisible();
  expect(store.detailGets).toBe(1);
  expect(store.patches).toEqual([]);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(trigger).toHaveText('비활성');
  audit.assertClean();
});

test('가입 신청 큐에는 드롭다운이 없다 (1280px)', async ({ page }) => {
  const audit = installBrowserAudit(page);
  await installSyntheticAuthority(
    page,
    ADMIN_SESSION,
    adminUsersHandlers(createStore()),
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/dashboard/applicants');
  await expect(
    page.getByRole('heading', { name: '가입 신청', exact: true }),
  ).toBeVisible();
  const region = page.getByRole('region', { name: '가입 신청 표' });
  await expect(region).toContainText('합성 사용자 05');
  await expect(page.getByText('가입 신청을 불러오는 중…')).toHaveCount(0);
  await expect(page.locator('[data-slot="select-trigger"]')).toHaveCount(0);
  audit.assertClean();
});

test('권한 필드가 없는 목록 응답은 배지로 렌더링되고 오류가 없다 (1280px)', async ({
  page,
}) => {
  const audit = installBrowserAudit(page);
  await openDirectory(page, { width: 1280, height: 900 }, createStore(false));
  const region = tableRegion(page);
  await expect(region.locator('[data-slot="select-trigger"]')).toHaveCount(0);
  await expect(region.getByRole('row')).toHaveCount(
    adminUsersPage1Rows.length + 1,
  );
  for (const [name, badge] of [
    ['합성 사용자 11', '미지정'],
    ['합성 사용자 09', '비활성'],
    ['합성 사용자 02', '관리자'],
    ['합성 사용자 04', '교직원'],
  ] as const) {
    await expect(
      rowOf(page, name)
        .getByText(badge, { exact: true })
        .locator('visible=true'),
    ).toHaveCount(1);
  }
  audit.assertClean();
});

function layoutMetrics(page: Page) {
  return page.evaluate(() => {
    const root = document.documentElement;
    const main = document.getElementById('main-content');
    const table = document.querySelector('[data-slot="table-container"]');
    if (!main || !table) throw new Error('scroll containers missing');
    return {
      document: {
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
      },
      scroller: {
        scrollWidth: main.scrollWidth,
        clientWidth: main.clientWidth,
      },
      table: { scrollWidth: table.scrollWidth, clientWidth: table.clientWidth },
      rowHeights: Array.from(document.querySelectorAll('tbody tr')).map((row) =>
        Math.ceil(row.getBoundingClientRect().height),
      ),
    };
  });
}

async function captureFull(
  page: Page,
  dir: string,
  name: string,
): Promise<void> {
  await page.screenshot({
    path: path.join(dir, `${CAPTURE_PREFIX}-${name}.png`),
    fullPage: true,
    animations: 'disabled',
  });
}

async function growViewportUntilScrollerFits(
  page: Page,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  const overflow = await contentHeight(page);
  await page.setViewportSize({
    width: viewport.width,
    height: viewport.height + overflow,
  });
  await settle(page);
  expect(await contentHeight(page)).toBe(0);
}

async function captureWidth(
  page: Page,
  dir: string,
  viewport: { readonly width: number; readonly height: number },
): Promise<void> {
  if (viewport.width !== DESKTOP.width && viewport.width !== MOBILE.width) {
    await captureFull(page, dir, `width-${viewport.width}`);
    return;
  }
  await captureFull(page, dir, `full-${viewport.width}`);
  await growViewportUntilScrollerFits(page, viewport);
  if (viewport.width === DESKTOP.width) {
    await page.locator(TABLE_CONTAINER).screenshot({
      path: path.join(dir, `${CAPTURE_PREFIX}-element-table-1440.png`),
      animations: 'disabled',
    });
  }
  await captureFull(
    page,
    path.join(dir, 'pw'),
    `full-${viewport.width}-extended`,
  );
  await page.setViewportSize(viewport);
  await settle(page);
}

async function captureDialog(page: Page, dir: string): Promise<void> {
  await page.setViewportSize(DESKTOP);
  await settle(page);
  const trigger = cellControl(page, '합성 사용자 01', '회원 유형');
  await choose(trigger, '교직원');
  const dialog = dialogNamed(page, '교직원으로 변경');
  await expect(dialog).toBeVisible();
  await captureFull(page, dir, 'dialog-1440');
  await dialog.getByRole('button', { name: '취소' }).click();
  await expect(dialog).toBeHidden();
}

test('레이아웃: 문서 가로 넘침 없음, 1280px 이상 표 내부 스크롤 없음, 390px 행 높이 320px 이하', async ({
  page,
}, testInfo) => {
  const audit = installBrowserAudit(page);
  await openDirectory(page, DESKTOP);
  if (CAPTURE_DIR)
    await mkdir(path.join(CAPTURE_DIR, 'pw'), { recursive: true });

  for (const width of LAYOUT_WIDTHS) {
    const viewport =
      width === MOBILE.width ? MOBILE : { width, height: DESKTOP.height };
    await page.setViewportSize(viewport);
    await settle(page);
    const metrics = await layoutMetrics(page);
    testInfo.annotations.push({
      type: `layout-${width}`,
      description: JSON.stringify(metrics),
    });
    expect(
      metrics.document.scrollWidth,
      `document overflow at ${width}px`,
    ).toBeLessThanOrEqual(metrics.document.clientWidth);
    expect(
      metrics.scroller.scrollWidth,
      `#main-content overflow at ${width}px`,
    ).toBeLessThanOrEqual(metrics.scroller.clientWidth);
    if (width >= 1280) {
      expect(
        metrics.table.scrollWidth,
        `table overflow at ${width}px`,
      ).toBeLessThanOrEqual(metrics.table.clientWidth);
    }
    if (width === MOBILE.width) {
      expect(metrics.rowHeights).toHaveLength(adminUsersPage1Rows.length);
      expect(
        Math.max(...metrics.rowHeights),
        'mobile row height',
      ).toBeLessThanOrEqual(MAX_MOBILE_ROW_HEIGHT);
      const row = rowOf(page, '합성 사용자 01');
      for (const control of ['회원 유형', '관리자 접근', '계정 상태']) {
        await expect(
          row.getByRole('combobox', { name: control, exact: true }),
        ).toBeVisible();
      }
    }
    if (CAPTURE_DIR) await captureWidth(page, CAPTURE_DIR, viewport);
  }
  if (CAPTURE_DIR) await captureDialog(page, CAPTURE_DIR);
  audit.assertClean();
});
