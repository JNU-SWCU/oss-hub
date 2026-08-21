import { expect, type Page } from '@playwright/test';

interface FailedResponse {
  readonly status: number;
  readonly url: string;
}

export interface BrowserAudit {
  readonly assertClean: (allowedStatuses?: readonly number[]) => void;
}

export function installBrowserAudit(page: Page): BrowserAudit {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requestFailures: string[] = [];
  const failedResponses: FailedResponse[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('requestfailed', (request) => {
    requestFailures.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'unknown'}`,
    );
  });
  page.on('response', (response) => {
    if (response.status() >= 400) {
      failedResponses.push({ status: response.status(), url: response.url() });
    }
  });

  return {
    assertClean(allowedStatuses = []) {
      const allowed = new Set(allowedStatuses);
      expect(pageErrors, 'pageerror events').toEqual([]);
      expect(consoleErrors, 'console error events').toEqual([]);
      expect(
        requestFailures.filter(
          (failure) => !failure.endsWith('net::ERR_ABORTED'),
        ),
        'non-cancellation requestfailed events',
      ).toEqual([]);
      expect(
        failedResponses.filter(({ status }) => !allowed.has(status)),
        'unexpected failed responses',
      ).toEqual([]);
    },
  };
}
