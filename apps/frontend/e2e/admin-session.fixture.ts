import { expect, test as base } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

import { e2eEnvironment } from './environment';
import {
  ADMIN_SEED_GITHUB_ID,
  authSeedGithubId,
  forgeSessionToken,
  sessionCookieName,
} from './support/session-cookie';

type AuthSeedPageFactory = (scenarioId: string) => Promise<Page>;

type AdminFixtures = {
  readonly adminPage: Page;
  readonly authSeedPage: AuthSeedPageFactory;
  readonly expectAdminResourceStatusError: (status: number) => void;
};

type InternalFixtures = {
  readonly adminSession: AuthenticatedPage;
};

// Chrome이 실패한 리소스 응답에 자동으로 남기는 정보성 로그다. PR04H
// tombstone 테스트가 의도적으로 만든 410만 예외로 두고, 일반 세션의 404·500과
// 애플리케이션 오류(pageerror·console.error)는 계속 잡아낸다.
const RESOURCE_STATUS_ERROR_RE =
  /^Failed to load resource: the server responded with a status of (\d+)/;

function isExpectedResourceStatusError(
  text: string,
  expectedStatuses: ReadonlySet<number>,
): boolean {
  const match = RESOURCE_STATUS_ERROR_RE.exec(text);
  return match !== null && expectedStatuses.has(Number(match[1]));
}

interface AuthenticatedPage {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly consoleErrors: string[];
  readonly expectedResourceStatuses: Set<number>;
}

async function createAuthenticatedPage(
  browser: Browser,
  githubId: bigint,
  expectedResourceStatuses = new Set<number>(),
): Promise<AuthenticatedPage> {
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: sessionCookieName(e2eEnvironment.baseUrl.startsWith('https://')),
      value: forgeSessionToken(e2eEnvironment.sessionSecret, githubId),
      url: e2eEnvironment.baseUrl,
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !isExpectedResourceStatusError(message.text(), expectedResourceStatuses)
    ) {
      consoleErrors.push(message.text());
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  return { context, page, consoleErrors, expectedResourceStatuses };
}

function brokenContractPath(): string | null {
  switch (e2eEnvironment.brokenLegacyContract) {
    case null:
      return null;
    case 'users':
      return e2eEnvironment.legacyContracts.users;
    case 'staff-requests':
      return e2eEnvironment.legacyContracts.staffRequests;
    default: {
      const exhaustive: never = e2eEnvironment.brokenLegacyContract;
      return exhaustive;
    }
  }
}

export const test = base.extend<AdminFixtures & InternalFixtures>({
  adminSession: async ({ browser }, use) => {
    const path = brokenContractPath();
    const expectedResourceStatuses = new Set<number>();
    if (path !== null) expectedResourceStatuses.add(410);
    const session = await createAuthenticatedPage(
      browser,
      ADMIN_SEED_GITHUB_ID,
      expectedResourceStatuses,
    );
    const { context, page, consoleErrors } = session;

    if (path !== null) {
      await context.route(`**${path}**`, async (route) => {
        await route.fulfill({
          status: 410,
          contentType: 'application/problem+json',
          body: JSON.stringify({
            type: 'about:blank',
            title: 'Synthetic legacy contract break',
            status: 410,
            detail: 'The legacy endpoint is intentionally unavailable.',
            instance: path,
            code: 'TST_001',
          }),
        });
      });
    }

    await use(session);
    await context.close();
    expect(consoleErrors, 'browser console and page errors').toEqual([]);
  },
  adminPage: async ({ adminSession }, use) => {
    await use(adminSession.page);
  },
  expectAdminResourceStatusError: async ({ adminSession }, use) => {
    await use((status) => adminSession.expectedResourceStatuses.add(status));
  },
  authSeedPage: async ({ browser }, use) => {
    const sessions: AuthenticatedPage[] = [];
    await use(async (scenarioId) => {
      const session = await createAuthenticatedPage(
        browser,
        authSeedGithubId(scenarioId),
      );
      sessions.push(session);
      return session.page;
    });
    for (const session of sessions) {
      await session.context.close();
      expect(session.consoleErrors, 'browser console and page errors').toEqual(
        [],
      );
    }
  },
});

export { expect } from '@playwright/test';
