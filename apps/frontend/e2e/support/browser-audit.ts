import { expect, type Page } from '@playwright/test';

interface FailedResponse {
  readonly status: number;
  readonly url: string;
}

interface ConsoleError {
  readonly text: string;
}

export interface BrowserAuditReceipt {
  readonly pageErrors: number;
  readonly consoleErrors: number;
  readonly requestFailures: number;
  readonly allowedFailedResponses: readonly {
    readonly status: number;
    readonly path: string;
  }[];
  readonly unexpectedFailedResponses: number;
  readonly clean: boolean;
}

export interface BrowserAudit {
  readonly assertClean: (allowedStatuses?: readonly number[]) => void;
  readonly receipt: (
    allowedStatuses?: readonly number[],
  ) => BrowserAuditReceipt;
}

const RESOURCE_STATUS_ERROR_RE =
  /^Failed to load resource: the server responded with a status of (\d+)/;

export function installBrowserAudit(page: Page): BrowserAudit {
  const pageErrors: string[] = [];
  const consoleErrors: ConsoleError[] = [];
  const requestFailures: string[] = [];
  const failedResponses: FailedResponse[] = [];

  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error')
      consoleErrors.push({ text: message.text() });
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

  function receipt(
    allowedStatuses: readonly number[] = [],
  ): BrowserAuditReceipt {
    const allowed = new Set(allowedStatuses);
    const unexpectedConsoleErrors = consoleErrors.filter(({ text }) => {
      const status = Number(RESOURCE_STATUS_ERROR_RE.exec(text)?.[1]);
      return !Number.isInteger(status) || !allowed.has(status);
    });
    const nonCancellationFailures = requestFailures.filter(
      (failure) => !failure.endsWith('net::ERR_ABORTED'),
    );
    const allowedFailedResponses = failedResponses
      .filter(({ status }) => allowed.has(status))
      .map(({ status, url }) => ({ status, path: new URL(url).pathname }));
    const unexpectedFailedResponses = failedResponses.filter(
      ({ status }) => !allowed.has(status),
    );
    return {
      pageErrors: pageErrors.length,
      consoleErrors: unexpectedConsoleErrors.length,
      requestFailures: nonCancellationFailures.length,
      allowedFailedResponses,
      unexpectedFailedResponses: unexpectedFailedResponses.length,
      clean:
        pageErrors.length === 0 &&
        unexpectedConsoleErrors.length === 0 &&
        nonCancellationFailures.length === 0 &&
        unexpectedFailedResponses.length === 0,
    };
  }

  return {
    receipt,
    assertClean(allowedStatuses = []) {
      const result = receipt(allowedStatuses);
      expect(result.pageErrors, 'pageerror events').toBe(0);
      expect(result.consoleErrors, 'unexpected console error events').toBe(0);
      expect(
        result.requestFailures,
        'non-cancellation requestfailed events',
      ).toBe(0);
      expect(
        result.unexpectedFailedResponses,
        'unexpected failed responses',
      ).toBe(0);
    },
  };
}
