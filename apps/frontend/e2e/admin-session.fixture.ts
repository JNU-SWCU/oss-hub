import { expect, test as base } from '@playwright/test';
import type { Page } from '@playwright/test';

import { e2eEnvironment } from './environment';
import {
  ADMIN_SEED_GITHUB_ID,
  forgeSessionToken,
  sessionCookieName,
} from './support/session-cookie';

type AdminFixtures = {
  readonly adminPage: Page;
};

// Chrome이 4xx/5xx 응답을 받은 리소스 요청마다 자동으로 남기는 네트워크
// 계층 정보성 로그다. PR04H tombstone 테스트는 의도적으로 404를 유발하므로
// 이 메시지까지 "예상치 못한 콘솔 에러"로 오탐하면 안 된다. 애플리케이션
// 코드가 던지는 실제 에러(pageerror·console.error)는 이 패턴에 걸리지
// 않으므로 계속 잡아낸다.
const RESOURCE_STATUS_ERROR_RE =
  /^Failed to load resource: the server responded with a status of \d+/;

function isExpectedResourceStatusError(text: string): boolean {
  return RESOURCE_STATUS_ERROR_RE.test(text);
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

export const test = base.extend<AdminFixtures>({
  adminPage: async ({ browser }, use) => {
    const context = await browser.newContext();
    await context.addCookies([
      {
        name: sessionCookieName(e2eEnvironment.baseUrl.startsWith('https://')),
        value: forgeSessionToken(
          e2eEnvironment.sessionSecret,
          ADMIN_SEED_GITHUB_ID,
        ),
        url: e2eEnvironment.baseUrl,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ]);

    const path = brokenContractPath();
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

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    page.on('console', (message) => {
      if (
        message.type() === 'error' &&
        !isExpectedResourceStatusError(message.text())
      ) {
        consoleErrors.push(message.text());
      }
    });
    page.on('pageerror', (error) => {
      consoleErrors.push(error.message);
    });

    await use(page);
    await context.close();
    expect(consoleErrors, 'browser console and page errors').toEqual([]);
  },
});

export { expect } from '@playwright/test';
