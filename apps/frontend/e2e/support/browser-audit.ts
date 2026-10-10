import { expect, type Page } from '@playwright/test';

export interface AuditRequest {
  readonly method: () => string;
  readonly url: () => string;
  readonly failure: () => { readonly errorText: string } | null;
}

export interface AuditResponse {
  readonly status: () => number;
  readonly url: () => string;
  readonly request: () => AuditRequest;
}

export interface AuditConsoleMessage {
  readonly type: () => string;
  readonly text: () => string;
  readonly location: () => { readonly url: string };
}

export interface AuditEventSource {
  onPageError(listener: (error: Error) => void): void;
  onConsole(listener: (message: AuditConsoleMessage) => void): void;
  onRequestFailed(listener: (request: AuditRequest) => void): void;
  onResponse(listener: (response: AuditResponse) => void): void;
}

function auditEventsOf(page: Page): AuditEventSource {
  return {
    onPageError: (listener) => void page.on('pageerror', listener),
    onConsole: (listener) => void page.on('console', listener),
    onRequestFailed: (listener) => void page.on('requestfailed', listener),
    onResponse: (listener) => void page.on('response', listener),
  };
}

function toEventSource(page: Page | AuditEventSource): AuditEventSource {
  return 'onResponse' in page ? page : auditEventsOf(page);
}

interface FailedResponse {
  readonly status: number;
  readonly path: string | null;
  readonly method: string;
}

type ReadableFailedResponse = Omit<FailedResponse, 'path'> & {
  readonly path: string;
};

interface ConsoleError {
  readonly text: string;
  readonly path: string | null;
}

interface AllowedFailedResponse {
  readonly status: number;
  readonly path: string;

  readonly method?: string;
}

interface BrowserAuditReceipt {
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
  readonly assertClean: (allowed?: readonly AllowedFailedResponse[]) => void;
  readonly receipt: (
    allowed?: readonly AllowedFailedResponse[],
  ) => BrowserAuditReceipt;
}

const RESOURCE_STATUS_ERROR_RE =
  /^Failed to load resource: the server responded with a status of (\d+)/;

function pathOf(url: string): string | null {
  return URL.canParse(url) ? new URL(url).pathname : null;
}

export function installBrowserAudit(
  page: Page | AuditEventSource,
): BrowserAudit {
  const source = toEventSource(page);
  const pageErrors: string[] = [];
  const consoleErrors: ConsoleError[] = [];
  const requestFailures: string[] = [];
  const failedResponses: FailedResponse[] = [];

  source.onPageError((error) => pageErrors.push(error.message));
  source.onConsole((message) => {
    if (message.type() === 'error')
      consoleErrors.push({
        text: message.text(),
        path: pathOf(message.location().url),
      });
  });
  source.onRequestFailed((request) => {
    requestFailures.push(
      `${request.method()} ${request.url()} ${request.failure()?.errorText ?? 'unknown'}`,
    );
  });
  source.onResponse((response) => {
    if (response.status() >= 400) {
      failedResponses.push({
        status: response.status(),
        path: pathOf(response.url()),
        method: response.request().method(),
      });
    }
  });

  function receipt(
    allowed: readonly AllowedFailedResponse[] = [],
  ): BrowserAuditReceipt {
    const allows = (failure: ReadableFailedResponse): boolean =>
      allowed.some(
        (entry) =>
          entry.status === failure.status &&
          entry.path === failure.path &&
          (entry.method === undefined || entry.method === failure.method),
      );
    const allowsConsole = (status: number, path: string): boolean =>
      allowed.some((entry) => entry.status === status && entry.path === path);

    const readable = (
      failure: FailedResponse,
    ): readonly ReadableFailedResponse[] =>
      failure.path === null ? [] : [{ ...failure, path: failure.path }];

    const unexpectedConsoleErrors = consoleErrors.filter(({ text, path }) => {
      const status = Number(RESOURCE_STATUS_ERROR_RE.exec(text)?.[1]);
      if (!Number.isInteger(status)) return true;
      return path === null || !allowsConsole(status, path);
    });
    const nonCancellationFailures = requestFailures.filter(
      (failure) => !failure.endsWith('net::ERR_ABORTED'),
    );

    const allowedFailedResponses = failedResponses
      .flatMap(readable)
      .filter(allows)
      .map(({ status, path }) => ({ status, path }));
    const unexpectedFailedResponses =
      failedResponses.length - allowedFailedResponses.length;
    return {
      pageErrors: pageErrors.length,
      consoleErrors: unexpectedConsoleErrors.length,
      requestFailures: nonCancellationFailures.length,
      allowedFailedResponses,
      unexpectedFailedResponses,
      clean:
        pageErrors.length === 0 &&
        unexpectedConsoleErrors.length === 0 &&
        nonCancellationFailures.length === 0 &&
        unexpectedFailedResponses === 0,
    };
  }

  return {
    receipt,
    assertClean(allowed = []) {
      const result = receipt(allowed);
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
