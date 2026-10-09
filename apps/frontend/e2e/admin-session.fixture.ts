import { expect, test as base } from '@playwright/test';
import type {
  Browser,
  BrowserContext,
  BrowserContextOptions,
  Page,
} from '@playwright/test';

import { e2eEnvironment } from './environment';
import {
  ADMIN_SEED_GITHUB_ID,
  authSeedGithubId,
  forgeSessionToken,
  sessionCookieName,
} from './support/session-cookie';
import { PROGRAM_AUTHORING_E2E } from './support/program-authoring-flow';

type AuthSeedPageFactory = (scenarioId: string) => Promise<Page>;
type ProgramAuthoringActorPageFactory = (
  actor: keyof typeof PROGRAM_AUTHORING_E2E.actors,
  expectedResourceError?:
    ExpectedResourceError | readonly ExpectedResourceError[],
) => Promise<Page>;

type ExpectedResourceError = {
  readonly status: number;
  readonly pathname: string;
};

type AdminFixtures = {
  readonly adminPage: Page;
  readonly authSeedPage: AuthSeedPageFactory;
  readonly programAuthoringActorPage: ProgramAuthoringActorPageFactory;
  readonly expectAdminResourceStatusError: (status: number) => void;
};

type InternalFixtures = {
  readonly adminSession: AuthenticatedPage;
};

const RESOURCE_STATUS_ERROR_RE =
  /^Failed to load resource: the server responded with a status of (\d+)/;

function isExpectedResourceStatusError(
  text: string,
  locationUrl: string,
  expectedStatuses: ReadonlySet<number>,
  expectedResourceErrors: readonly ExpectedResourceError[],
): boolean {
  const match = RESOURCE_STATUS_ERROR_RE.exec(text);
  if (match === null) return false;
  const status = Number(match[1]);
  if (expectedStatuses.has(status)) return true;
  let pathname: string;
  try {
    pathname = new URL(locationUrl).pathname;
  } catch {
    return false;
  }
  return expectedResourceErrors.some(
    (expected) => expected.status === status && expected.pathname === pathname,
  );
}

interface FailedResponse {
  readonly status: number;
  readonly url: string;
}

function consoleErrorLabel(failedResponses: readonly FailedResponse[]): string {
  const label = 'browser console and page errors';
  if (failedResponses.length === 0) {
    return `${label} (기록된 4xx·5xx 응답 없음)`;
  }
  const occurrences = new Map<string, number>();
  for (const { status, url } of failedResponses) {
    const key = `${status} ${url}`;
    occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
  }
  const lines = [...occurrences].map(([key, count]) =>
    count === 1 ? `  - ${key}` : `  - ${key} (${count}회)`,
  );
  return `${label}\n이 세션에서 실패한 응답:\n${lines.join('\n')}`;
}

interface AuthenticatedPage {
  readonly context: BrowserContext;
  readonly page: Page;
  readonly consoleErrors: string[];
  readonly failedResponses: FailedResponse[];
  readonly expectedResourceStatuses: Set<number>;
  readonly expectedResourceErrors: ExpectedResourceError[];
}

async function createAuthenticatedPage(
  browser: Browser,
  githubId: bigint,
  contextOptions: Pick<BrowserContextOptions, 'timezoneId' | 'viewport'>,
  expectedResourceStatuses = new Set<number>(),
  expectedResourceErrors: readonly ExpectedResourceError[] = [],
): Promise<AuthenticatedPage> {
  const context = await browser.newContext(contextOptions);
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
  const failedResponses: FailedResponse[] = [];
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      failedResponses.push({ status, url: response.url() });
    }
  });
  page.on('console', (message) => {
    const locationUrl = message.location().url;
    if (
      message.type() === 'error' &&
      !isExpectedResourceStatusError(
        message.text(),
        locationUrl,
        expectedResourceStatuses,
        expectedResourceErrors,
      )
    ) {
      consoleErrors.push(
        locationUrl ? `${message.text()} [${locationUrl}]` : message.text(),
      );
    }
  });
  page.on('pageerror', (error) => {
    consoleErrors.push(error.message);
  });
  return {
    context,
    page,
    consoleErrors,
    failedResponses,
    expectedResourceStatuses,
    expectedResourceErrors: [...expectedResourceErrors],
  };
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
  adminSession: async ({ browser, timezoneId, viewport }, use) => {
    const path = brokenContractPath();
    const expectedResourceStatuses = new Set<number>();
    if (path !== null) expectedResourceStatuses.add(410);
    const session = await createAuthenticatedPage(
      browser,
      ADMIN_SEED_GITHUB_ID,
      { timezoneId, viewport },
      expectedResourceStatuses,
    );
    const { context, consoleErrors, failedResponses } = session;

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
    expect(consoleErrors, consoleErrorLabel(failedResponses)).toEqual([]);
  },
  adminPage: async ({ adminSession }, use) => {
    await use(adminSession.page);
  },
  expectAdminResourceStatusError: async ({ adminSession }, use) => {
    await use((status) => adminSession.expectedResourceStatuses.add(status));
  },
  authSeedPage: async ({ browser, timezoneId, viewport }, use) => {
    const sessions: AuthenticatedPage[] = [];
    await use(async (scenarioId) => {
      const session = await createAuthenticatedPage(
        browser,
        authSeedGithubId(scenarioId),
        { timezoneId, viewport },
      );
      sessions.push(session);
      return session.page;
    });
    for (const session of sessions) {
      await session.context.close();
      expect(
        session.consoleErrors,
        consoleErrorLabel(session.failedResponses),
      ).toEqual([]);
    }
  },
  programAuthoringActorPage: async ({ browser, timezoneId, viewport }, use) => {
    const sessions: AuthenticatedPage[] = [];
    await use(async (actor, expectedResourceError) => {
      const session = await createAuthenticatedPage(
        browser,
        PROGRAM_AUTHORING_E2E.actors[actor],
        { timezoneId, viewport },
        new Set<number>(),
        expectedResourceError === undefined
          ? []
          : 'pathname' in expectedResourceError
            ? [expectedResourceError]
            : expectedResourceError,
      );
      sessions.push(session);
      return session.page;
    });
    for (const session of sessions) {
      await session.context.close();
      expect(
        session.consoleErrors,
        consoleErrorLabel(session.failedResponses),
      ).toEqual([]);
    }
  },
});

export { expect } from '@playwright/test';
