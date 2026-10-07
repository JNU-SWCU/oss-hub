import type {
  AuditConsoleMessage,
  AuditEventSource,
  AuditRequest,
  AuditResponse,
} from './browser-audit';

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

  emitConsoleResourceError(failure: { status: number; url: string }): void {
    this.emitConsoleError(
      `Failed to load resource: the server responded with a status of ${failure.status} (Internal Server Error)`,
      failure.url,
    );
  }

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
