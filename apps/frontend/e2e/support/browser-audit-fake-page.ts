import type {
  AuditConsoleMessage,
  AuditEventSource,
  AuditRequest,
  AuditResponse,
} from './browser-audit';

/**
 * `installBrowserAudit`이 실제로 읽는 브라우저 신호만 담은 in-memory fake.
 *
 * 감사기는 브라우저에 아무것도 묻지 않고 네 가지 이벤트를 구독하기만 한다. 그래서
 * 판정 논리를 검증하는 데 실제 브라우저가 필요하지 않다 — 같은 모양의 이벤트를 직접
 * 흘려 넣으면 되고, 대기·재시도 없이 결정적이다. 여기서 만드는 것은 mock이 아니라
 * 구독을 진짜로 기록하는 구현이며, 실제 Playwright의 `Page`가 감사기의 요구를
 * 만족하는지는 `browser-audit.ts`의 좁힌 타입이 컴파일 시점에 잡는다.
 */
export class BrowserEventSink implements AuditEventSource {
  private pageErrorListeners: ((error: Error) => void)[] = [];
  private consoleListeners: ((message: AuditConsoleMessage) => void)[] = [];
  private requestFailedListeners: ((request: AuditRequest) => void)[] = [];
  private responseListeners: ((response: AuditResponse) => void)[] = [];

  onPageError(listener: (error: Error) => void): void {
    this.pageErrorListeners.push(listener);
  }

  onConsole(listener: (message: AuditConsoleMessage) => void): void {
    this.consoleListeners.push(listener);
  }

  onRequestFailed(listener: (request: AuditRequest) => void): void {
    this.requestFailedListeners.push(listener);
  }

  onResponse(listener: (response: AuditResponse) => void): void {
    this.responseListeners.push(listener);
  }

  /** 브라우저가 4xx·5xx 응답을 받았을 때 흘리는 `response` 이벤트. */
  emitFailedResponse(failure: {
    status: number;
    url: string;
    method?: string;
  }): void {
    const response: AuditResponse = {
      status: () => failure.status,
      url: () => failure.url,
      request: () => ({
        method: () => failure.method ?? 'GET',
        url: () => failure.url,
        failure: () => null,
      }),
    };
    for (const listener of this.responseListeners) listener(response);
  }

  /**
   * 같은 실패 응답이 콘솔에도 남기는 `Failed to load resource` 오류.
   *
   * 문구는 상태 코드만 담고 경로는 `location().url`에 있다 — 실제 Chrome이 그렇게 준다.
   */
  emitConsoleResourceError(failure: { status: number; url: string }): void {
    this.emitConsoleError(
      `Failed to load resource: the server responded with a status of ${failure.status} (Internal Server Error)`,
      failure.url,
    );
  }

  /** 상태 코드를 담지 않는 애플리케이션 콘솔 오류. */
  emitConsoleError(text: string, url: string): void {
    const message: AuditConsoleMessage = {
      type: () => 'error',
      text: () => text,
      location: () => ({ url }),
    };
    for (const listener of this.consoleListeners) listener(message);
  }

  emitPageError(message: string): void {
    const error = new Error(message);
    for (const listener of this.pageErrorListeners) listener(error);
  }

  emitRequestFailure(failure: {
    method: string;
    url: string;
    errorText: string;
  }): void {
    const request: AuditRequest = {
      method: () => failure.method,
      url: () => failure.url,
      failure: () => ({ errorText: failure.errorText }),
    };
    for (const listener of this.requestFailedListeners) listener(request);
  }
}
