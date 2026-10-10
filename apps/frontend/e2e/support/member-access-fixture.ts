import type { Page, Route } from '@playwright/test';

type SyntheticMemberKind = 'STUDENT' | 'STAFF';

export interface SyntheticAuthority {
  readonly role: 'STUDENT' | 'STAFF' | 'ADMIN' | null;
  readonly memberKind: SyntheticMemberKind | null;
  readonly hasStaffAccess: boolean;
  readonly hasAdminAccess: boolean;
  readonly isProfileComplete?: boolean;
}

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
