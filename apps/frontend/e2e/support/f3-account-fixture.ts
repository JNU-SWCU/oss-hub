import type { Page, Route } from '@playwright/test';

/**
 * 로그아웃·설정 저장 **실패 경로**를 브라우저에서 재현하기 위한 합성 계정.
 *
 * 실패를 실제 스택으로 만들려면 백엔드를 고장 내야 하는데, 그러면 같은 실행의 다른
 * 스펙까지 함께 흔들린다. 실패는 이 라우트 층에서 응답 하나로 만들고, 화면이 그
 * 응답을 어떻게 다루는지만 본다 — 검증 대상은 백엔드가 아니라 화면의 복구 동작이다.
 *
 * 공유 헬퍼는 세션 GET과 미등록 method/path 실패뿐이다. 시나리오 응답은 각
 * installer와 스펙이 정확한 method/path로 선언한다. 가로챈 `/api/v1/**` 가운데
 * 등록되지 않은 요청은 200 `{}` / `null`로 넘기지 않고 method/path를 담아 던진다.
 */

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

/** 설정 화면이 불러온 값으로 그릴 프로필. */
export const F3_SAVED_PROFILE = {
  name: '합성 저장된 이름',
  studentId: '260901',
  department: '인공지능학부',
  phone: '1'.repeat(10),
  isComplete: true,
} as const;

export const F3_SAVED_NOTIFICATION = {
  notificationEmail: 'synthetic-f3@example.com',
  notifyEnabled: true,
} as const;

/** 스펙이 붙이는 UI 전용 응답. 키는 `METHOD /api/v1/...` 경로(쿼리 제외)다. */
export type F3ApiHandlers = {
  readonly [methodAndPath: string]: (route: Route) => Promise<void>;
};

/** 백엔드 ProblemDetail 계약(`lib/api-client.ts`의 `isProblemDetail`)과 같은 형태. */
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

/** 세션 전용 공유 헬퍼 — GET `/api/v1/auth/session`만 담당한다. */
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
  /** 화면이 실제로 로그아웃 요청을 보낸 횟수 — 실패 경로에서도 1이어야 한다. */
  readonly logoutRequests: () => number;
}

/** 로그아웃 시나리오가 출발하는 화면 — 본문 조회 응답은 스펙이 선언한다. */
export const F3_LOGOUT_ORIGIN_PATH = '/settings';

/**
 * 로그아웃 결과가 정해진 합성 세션.
 *
 * `outcome: 'success'`는 백엔드 계약대로 `{ isAuthenticated: false }`를 돌려주고 이후
 * 세션 조회도 비로그인이 된다 — 로그아웃 완료 화면은 그 상태에서 그려진다.
 * `outcome: 'failure'`는 500 ProblemDetail을 돌려주고 세션은 살아 있는 채로 둔다.
 *
 * 설정 본문·랜딩 공개 목록처럼 시나리오가 필요한 조회는 `extraHandlers`로 스펙이 붙인다.
 */
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
  /** 프로필 PATCH 시도 횟수. 저장 실패 시나리오에서 1회를 넘지 않아야 한다. */
  readonly profileWrites: () => number;
  /** 알림 설정 PATCH 시도 횟수. 프로필이 실패하면 0이어야 한다. */
  readonly notificationWrites: () => number;
}

/**
 * 프로필 저장이 항상 500으로 끝나는 합성 설정 화면.
 *
 * 조회는 결정된 값을 돌려주고, PATCH는 저장 단계에 닿기 전에 거절한다.
 * 화면이 실패 뒤에도 고쳐 쓴 값을 유지하는지는 스펙의 DOM 판정이 담당한다.
 */
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
