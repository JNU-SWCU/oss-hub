import type { Page, Route } from '@playwright/test';

export type SyntheticMemberKind = 'STUDENT' | 'STAFF';

export interface SyntheticAuthority {
  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly memberKind: SyntheticMemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly isProfileComplete?: boolean;
}

/** 스펙이 붙이는 UI 전용 응답. 키는 `METHOD /api/v1/...` 경로(쿼리 제외)다. */
export type MemberAccessApiHandlers = {
  readonly [methodAndPath: string]: (route: Route) => Promise<void>;
};

function sessionBody(authority: SyntheticAuthority) {
  return {
    isAuthenticated: true,
    user: {
      nickname: 'synthetic-member-access',
      name: '합성 권한 사용자',
      email: null,
      avatarUrl: null,
      ...authority,
      isProfileComplete: authority.isProfileComplete ?? true,
    },
  };
}

export async function fulfillJson(
  route: Route,
  body: unknown,
  status = 200,
): Promise<void> {
  await route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  });
}

function unexpectedInterceptedApi(method: string, pathname: string): never {
  throw new Error(`Unexpected intercepted API request: ${method} ${pathname}`);
}

async function installExactApiRouter(
  page: Page,
  handlers: () => MemberAccessApiHandlers,
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

/**
 * 세션 GET만 공유한다. 메뉴·셸·검증 화면이 추가로 읽는 본문은 스펙이
 * `extraHandlers`로 정확한 method/path를 선언한다.
 *
 * 가로챈 `/api/v1/**` 가운데 등록되지 않은 요청(잘못된 method 포함)은 200 `{}`
 * 나 404로 넘기지 않고 method/path를 담아 던진다. 여기서 돌리는 조회는 UI 전용이며
 * 서버 영속 증거가 아니다.
 */
export async function installSyntheticAuthority(
  page: Page,
  authority: SyntheticAuthority,
  extraHandlers: MemberAccessApiHandlers = {},
): Promise<void> {
  await installExactApiRouter(page, () => ({
    'GET /api/v1/auth/session': async (route) => {
      await fulfillJson(route, sessionBody(authority));
    },
    ...extraHandlers,
  }));
}
