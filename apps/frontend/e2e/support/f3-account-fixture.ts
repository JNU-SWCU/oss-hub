import type { Page, Route } from '@playwright/test';

const SYNTHETIC_STUDENT = {
  nickname: 'synthetic-f3-account',
  name: '합성 F3 사용자',
  email: null,
  avatarUrl: null,
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: true,
} as const;

export const F3_SAVED_PROFILE = {
  name: '합성 저장된 이름',
  studentId: '260901',
  staffNumber: null,
  department: '인공지능학부',
  phone: '1'.repeat(10),
  isComplete: true,
} as const;

export const F3_SAVED_NOTIFICATION = {
  notificationEmail: 'synthetic-f3@example.com',
  notifyEnabled: true,
} as const;

export type F3ApiHandlers = {
  readonly [methodAndPath: string]: (route: Route) => Promise<void>;
};

function problemDetail(instance: string) {
  return {
    type: 'about:blank',
    title: '합성 서버 오류',
    status: 500,
    detail: '합성 실패 경로입니다.',
    instance,
    code: 'API_000',
  };
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

async function fulfillProblem(route: Route): Promise<void> {
  const pathname = new URL(route.request().url()).pathname;
  await route.fulfill({
    status: 500,
    contentType: 'application/problem+json',
    body: JSON.stringify(problemDetail(pathname)),
  });
}

function sessionBody(isAuthenticated: boolean) {
  return isAuthenticated
    ? { isAuthenticated: true, user: SYNTHETIC_STUDENT }
    : { isAuthenticated: false };
}

function sessionGetHandler(isAuthenticated: () => boolean) {
  return async (route: Route): Promise<void> => {
    await fulfillJson(route, sessionBody(isAuthenticated()));
  };
}

function unexpectedInterceptedApi(method: string, pathname: string): never {
  throw new Error(`Unexpected intercepted API request: ${method} ${pathname}`);
}

async function installExactApiRouter(
  page: Page,
  handlers: () => F3ApiHandlers,
): Promise<void> {
  await page.route('**/api/v1/**', async (route) => {
    const method = route.request().method();
    const pathname = new URL(route.request().url()).pathname;
    const handler = handlers()[`${method} ${pathname}`];
    if (!handler) {
      unexpectedInterceptedApi(method, pathname);
    }
    await handler(route);
  });
}

export interface LogoutFixture {
  readonly logoutRequests: () => number;
}

export const F3_LOGOUT_ORIGIN_PATH = '/settings';

export async function installLogoutFixture(
  page: Page,
  outcome: 'success' | 'failure',
  extraHandlers: F3ApiHandlers = {},
): Promise<LogoutFixture> {
  let loggedOut = false;
  let logoutRequests = 0;

  await installExactApiRouter(page, () => ({
    ...extraHandlers,
    'GET /api/v1/auth/session': sessionGetHandler(() => !loggedOut),
    'POST /api/v1/auth/logout': async (route) => {
      logoutRequests += 1;
      if (outcome === 'failure') {
        await fulfillProblem(route);
        return;
      }
      loggedOut = true;
      await fulfillJson(route, { isAuthenticated: false });
    },
  }));

  return { logoutRequests: () => logoutRequests };
}

export interface SettingsFailureFixture {
  readonly profileWrites: () => number;

  readonly notificationWrites: () => number;
}

export async function installSettingsSaveFailureFixture(
  page: Page,
  extraHandlers: F3ApiHandlers = {},
): Promise<SettingsFailureFixture> {
  let profileWrites = 0;
  let notificationWrites = 0;

  await installExactApiRouter(page, () => ({
    ...extraHandlers,
    'GET /api/v1/auth/session': sessionGetHandler(() => true),
    'GET /api/v1/users/me/profile': async (route) => {
      await fulfillJson(route, F3_SAVED_PROFILE);
    },
    'PATCH /api/v1/users/me/profile': async (route) => {
      profileWrites += 1;
      await fulfillProblem(route);
    },
    'GET /api/v1/users/me/notification-email': async (route) => {
      await fulfillJson(route, F3_SAVED_NOTIFICATION);
    },
    'PATCH /api/v1/users/me/notification-email': async (route) => {
      notificationWrites += 1;
      await fulfillJson(route, F3_SAVED_NOTIFICATION);
    },
  }));

  return {
    profileWrites: () => profileWrites,
    notificationWrites: () => notificationWrites,
  };
}
