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
      if (message.type() === 'error') {
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
