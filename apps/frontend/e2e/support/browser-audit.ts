import { expect, type Page } from '@playwright/test';

/**
 * 감사기가 브라우저 신호에서 실제로 읽는 것만 좁혀 둔 타입.
 *
 * Playwright의 `Request`·`Response`·`ConsoleMessage`가 이 모양을 그대로 만족하고,
 * 판정 논리는 브라우저 없이도 같은 신호만 흘려 넣어 검증할 수 있다
 * (`browser-audit-fake-page.ts`).
 */
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

/**
 * 감사기가 구독하는 네 가지 신호.
 *
 * Playwright의 `page.on(event, ...)` 오버로드를 그대로 받지 않고 이름별 구독으로 둔다 —
 * 그래야 감사기가 무엇을 읽는지가 시그니처에 다 드러나고, 같은 계약을 브라우저 없이도
 * 그대로 만족시킬 수 있다(`browser-audit-fake-page.ts`).
 */
export interface AuditEventSource {
  onPageError(listener: (error: Error) => void): void;
  onConsole(listener: (message: AuditConsoleMessage) => void): void;
  onRequestFailed(listener: (request: AuditRequest) => void): void;
  onResponse(listener: (response: AuditResponse) => void): void;
}

/** 실제 Playwright `Page`를 감사기가 읽는 네 가지 구독으로만 좁힌다. */
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

/**
 * 잡아 둔 신호. `path`가 `null`이면 URL을 읽지 못한 것이고, 그런 신호는 허용 대조를
 * 시작조차 하지 않는다 — 통과 여부가 문자열 우연에 걸리지 않도록 타입으로 못 박는다.
 */
interface FailedResponse {
  readonly status: number;
  readonly path: string | null;
  readonly method: string;
}

/** 허용 대조에 들어갈 수 있는 신호 — 경로를 읽어낸 것만 이 타입이 된다. */
type ReadableFailedResponse = Omit<FailedResponse, 'path'> & {
  readonly path: string;
};

interface ConsoleError {
  readonly text: string;
  readonly path: string | null;
}

/**
 * 시나리오가 **의도해서** 만든 실패 응답 하나를 가리키는 좌표.
 *
 * 상태 코드만으로 허용하면 그 실행의 모든 같은 상태가 함께 통과한다 — 로그아웃 실패를
 * 재현하려고 연 문으로 관계없는 화면의 500이 조용히 들어온다. 그래서 최소 단위는
 * `상태 + 경로`이고, 같은 경로에서 조회는 성공하고 쓰기만 실패하는 시나리오(설정 저장)는
 * `method`까지 못 박아 조회 쪽 실패를 덮지 않게 한다.
 */
export interface AllowedFailedResponse {
  readonly status: number;
  readonly path: string;
  /** 생략하면 그 경로·상태의 모든 메서드를 허용한다. */
  readonly method?: string;
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
  readonly assertClean: (allowed?: readonly AllowedFailedResponse[]) => void;
  readonly receipt: (
    allowed?: readonly AllowedFailedResponse[],
  ) => BrowserAuditReceipt;
}

const RESOURCE_STATUS_ERROR_RE =
  /^Failed to load resource: the server responded with a status of (\d+)/;

/**
 * 이벤트가 실어 온 URL에서 허용 대조에 쓸 경로를 뽑는다.
 *
 * 브라우저는 절대 URL이 아닌 신호도 남긴다(문서 밖에서 난 콘솔 오류의 빈 URL 등).
 * 그때 받은 문자열을 경로인 척 되돌리면, 허용 목록에 그 문자열과 같은 `path`가 적히는
 * 순간 읽지도 못한 신호가 통과해 버린다. 그래서 `null`을 돌린다 — 대조 자체가 성립하지
 * 않으니 그런 신호는 구조상 통과할 수 없고, 버려지지도 않고 그대로 실패로 남는다.
 */
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
    // 허용 대조는 **경로를 읽어낸 신호**만 받는다. `null`을 걸러내는 일을 대조 함수
    // 안의 방어 조건이 아니라 입력 타입으로 옮겨서, 읽지 못한 신호가 대조에 닿는 길
    // 자체를 없앤다 — 조건 하나를 지워도 통과가 열리지 않고 컴파일이 먼저 깨진다.
    // 응답은 메서드까지 대조하고, 콘솔은 메서드를 담지 않으므로 상태·경로까지만 본다.
    const allows = (failure: ReadableFailedResponse): boolean =>
      allowed.some(
        (entry) =>
          entry.status === failure.status &&
          entry.path === failure.path &&
          (entry.method === undefined || entry.method === failure.method),
      );
    const allowsConsole = (status: number, path: string): boolean =>
      allowed.some((entry) => entry.status === status && entry.path === path);

    /** 경로를 읽어낸 신호만 통과시키는 유일한 관문. */
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
    // 관문을 통과한 신호만 허용될 수 있다. 읽지 못해 통과하지 못한 신호는
    // `allowed`에 들어갈 길이 없으므로 자동으로 예상 밖 실패로 남는다.
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
