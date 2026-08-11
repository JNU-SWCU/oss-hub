import { expect, test as base } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';

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
) => Promise<Page>;

type AdminFixtures = {
  readonly adminPage: Page;
  readonly authSeedPage: AuthSeedPageFactory;
  readonly programAuthoringActorPage: ProgramAuthoringActorPageFactory;
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

// Chrome의 "Failed to load resource" 콘솔 메시지는 본문(text())에 URL을 담지
// 않지만, message.location().url에는 실려 온다 — 아래에서 이 값을 텍스트에
// 덧붙여 기록한다. 다만 이 리소스가 페이지의 request/response 이벤트를 거치지
// 않는 경우(예: 브라우저 프로세스가 자체적으로 쏘는 /favicon.ico 프로브)가
// 있어, 그때는 failedResponses에 대응 항목이 없다. 그런 상황까지 대비해
// 응답을 따로 받아 URL과 status를 짝지어 둔다.
interface FailedResponse {
  readonly status: number;
  readonly url: string;
}

// 진단 정보 전용이다. 이 목록으로 단언하지 않는다 — lifecycle 스펙은 권한 거부(403)와
// 낙관적 잠금 충돌(409)을 의도적으로 만들어 검증하므로, 정상 통과 실행에도 4xx가 들어 있다.
// 판정은 콘솔 오류가 계속 맡고, 이 목록은 그 판정이 깨졌을 때 URL을 보여주는 역할만 한다.
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
  const failedResponses: FailedResponse[] = [];
  page.on('response', (response) => {
    const status = response.status();
    if (status >= 400) {
      failedResponses.push({ status, url: response.url() });
    }
  });
  page.on('console', (message) => {
    if (
      message.type() === 'error' &&
      !isExpectedResourceStatusError(message.text(), expectedResourceStatuses)
    ) {
      const locationUrl = message.location().url;
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
  adminSession: async ({ browser }, use) => {
    const path = brokenContractPath();
    const expectedResourceStatuses = new Set<number>();
    if (path !== null) expectedResourceStatuses.add(410);
    const session = await createAuthenticatedPage(
      browser,
      ADMIN_SEED_GITHUB_ID,
      expectedResourceStatuses,
    );
    const { context, page, consoleErrors, failedResponses } = session;

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
      expect(
        session.consoleErrors,
        consoleErrorLabel(session.failedResponses),
      ).toEqual([]);
    }
  },
  programAuthoringActorPage: async ({ browser }, use) => {
    const sessions: AuthenticatedPage[] = [];
    await use(async (actor) => {
      const session = await createAuthenticatedPage(
        browser,
        PROGRAM_AUTHORING_E2E.actors[actor],
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
