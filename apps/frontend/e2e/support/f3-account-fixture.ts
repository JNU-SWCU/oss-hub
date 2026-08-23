import type { Page, Route } from '@playwright/test';

/**
 * 로그아웃·설정 저장 **실패 경로**를 브라우저에서 재현하기 위한 합성 계정.
 *
 * 실패를 실제 스택으로 만들려면 백엔드를 고장 내야 하는데, 그러면 같은 실행의 다른
 * 스펙까지 함께 흔들린다. 실패는 이 라우트 층에서 응답 하나로 만들고, 화면이 그
 * 응답을 어떻게 다루는지만 본다 — 검증 대상은 백엔드가 아니라 화면의 복구 동작이다.
 *
 * `member-access-fixture.ts`를 늘리지 않고 따로 두는 이유는 그쪽이 성공 경로 전용이고
 * 다른 레인이 동시에 손대고 있어서다.
 */

const SYNTHETIC_STUDENT = {
  nickname: 'synthetic-f3-account',
  name: '합성 F3 사용자',
  email: null,
  avatarUrl: null,
  role: 'STUDENT',
  memberKind: 'STUDENT',
  hasStaffAccess: false,
  hasAdminAccess: false,
  isProfileComplete: true,
} as const;

/** 화면이 실제로 저장돼 있다고 읽을 프로필 — 저장 실패 뒤 원복 판정의 기준값이다. */
export const F3_SAVED_PROFILE = {
  name: '합성 저장된 이름',
  studentId: '260901',
  department: '인공지능학부',
  isComplete: true,
} as const;

export const F3_SAVED_NOTIFICATION = {
  notificationEmail: 'synthetic-f3@example.com',
  notifyEnabled: true,
} as const;

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

export interface LogoutFixture {
  /** 화면이 실제로 로그아웃 요청을 보낸 횟수 — 실패 경로에서도 1이어야 한다. */
  readonly logoutRequests: () => number;
}

/** 로그아웃 시나리오가 출발하는 화면 — 같은 픽스처로 본문까지 온전히 그려진다. */
export const F3_LOGOUT_ORIGIN_PATH = '/settings';

/**
 * 로그아웃 결과가 정해진 합성 세션.
 *
 * `outcome: 'success'`는 백엔드 계약대로 `{ isAuthenticated: false }`를 돌려주고 이후
 * 세션 조회도 비로그인이 된다 — 로그아웃 완료 화면은 그 상태에서 그려진다.
 * `outcome: 'failure'`는 500 ProblemDetail을 돌려주고 세션은 살아 있는 채로 둔다.
 */
export async function installLogoutFixture(
  page: Page,
  outcome: 'success' | 'failure',
): Promise<LogoutFixture> {
  let loggedOut = false;
  let logoutRequests = 0;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (pathname.endsWith('/auth/logout') && request.method() === 'POST') {
      logoutRequests += 1;
      if (outcome === 'failure') {
        await fulfillProblem(route);
        return;
      }
      loggedOut = true;
      await fulfillJson(route, { isAuthenticated: false });
      return;
    }
    if (pathname.endsWith('/auth/session')) {
      await fulfillJson(route, sessionBody(!loggedOut));
      return;
    }
    if (pathname.endsWith('/users/me/profile')) {
      await fulfillJson(route, F3_SAVED_PROFILE);
      return;
    }
    if (pathname.endsWith('/users/me/notification-email')) {
      await fulfillJson(route, F3_SAVED_NOTIFICATION);
      return;
    }
    await fulfillJson(route, {});
  });

  return { logoutRequests: () => logoutRequests };
}

export interface SettingsFailureFixture {
  /** 프로필 PATCH 시도 횟수. 저장 실패 시나리오에서 1회를 넘지 않아야 한다. */
  readonly profileWrites: () => number;
  /** 알림 설정 PATCH 시도 횟수. 프로필이 실패하면 0이어야 한다. */
  readonly notificationWrites: () => number;
  /** 서버가 여전히 들고 있는 이름 — 실패한 저장이 값을 바꾸지 않았음을 확인한다. */
  readonly storedName: () => string;
}

/**
 * 프로필 저장이 항상 500으로 끝나는 합성 설정 화면.
 *
 * 조회는 결정된 값을 돌려주고, PATCH는 저장 단계에 닿기 전에 거절한다 — 서버가 든
 * 값이 그대로임을 이 픽스처가 직접 증명할 수 있어야 "원복"을 말할 수 있다.
 */
export async function installSettingsSaveFailureFixture(
  page: Page,
): Promise<SettingsFailureFixture> {
  let profileWrites = 0;
  let notificationWrites = 0;

  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const method = request.method();

    if (pathname.endsWith('/auth/session')) {
      await fulfillJson(route, sessionBody(true));
      return;
    }
    if (pathname.endsWith('/users/me/profile')) {
      if (method === 'GET') {
        await fulfillJson(route, F3_SAVED_PROFILE);
        return;
      }
      profileWrites += 1;
      await fulfillProblem(route);
      return;
    }
    if (pathname.endsWith('/users/me/notification-email')) {
      if (method === 'GET') {
        await fulfillJson(route, F3_SAVED_NOTIFICATION);
        return;
      }
      notificationWrites += 1;
      await fulfillJson(route, F3_SAVED_NOTIFICATION);
      return;
    }
    await fulfillJson(route, {});
  });

  return {
    profileWrites: () => profileWrites,
    notificationWrites: () => notificationWrites,
    storedName: () => F3_SAVED_PROFILE.name,
  };
}
