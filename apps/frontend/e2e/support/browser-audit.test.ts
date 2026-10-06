import { describe, expect, it } from 'vitest';

import { installBrowserAudit } from './browser-audit';
import { BrowserEventSink } from './browser-audit-fake-page';

const LOGOUT_PATH = '/api/v1/auth/logout';
const PROFILE_PATH = '/api/v1/users/me/profile';
const ORIGIN = 'http://127.0.0.1:3000';

describe('browser audit 허용 목록 — 상태 + 경로가 정확히 맞을 때만 통과한다', () => {
  it('의도한 상태·경로의 실패 응답은 통과시킨다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({
      status: 500,
      url: `${ORIGIN}${LOGOUT_PATH}`,
      method: 'POST',
    });
    sink.emitConsoleResourceError({
      status: 500,
      url: `${ORIGIN}${LOGOUT_PATH}`,
    });

    const receipt = audit.receipt([
      { status: 500, path: LOGOUT_PATH, method: 'POST' },
    ]);

    expect(receipt.clean).toBe(true);
    expect(receipt.unexpectedFailedResponses).toBe(0);
    expect(receipt.consoleErrors).toBe(0);
    expect(receipt.allowedFailedResponses).toEqual([
      { status: 500, path: LOGOUT_PATH },
    ]);
  });

  it('허용한 것과 다른 경로의 같은 상태는 실패로 남긴다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({ status: 500, url: `${ORIGIN}${LOGOUT_PATH}` });
    sink.emitFailedResponse({ status: 500, url: `${ORIGIN}${PROFILE_PATH}` });

    const receipt = audit.receipt([{ status: 500, path: LOGOUT_PATH }]);

    expect(receipt.unexpectedFailedResponses).toBe(1);
    expect(receipt.clean).toBe(false);
    expect(() =>
      audit.assertClean([{ status: 500, path: LOGOUT_PATH }]),
    ).toThrow();
  });

  it('허용한 것과 다른 경로의 콘솔 리소스 오류도 실패로 남긴다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitConsoleResourceError({
      status: 500,
      url: `${ORIGIN}${PROFILE_PATH}`,
    });

    const receipt = audit.receipt([{ status: 500, path: LOGOUT_PATH }]);

    expect(receipt.consoleErrors).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('허용한 것과 다른 상태는 경로가 같아도 실패로 남긴다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({ status: 503, url: `${ORIGIN}${LOGOUT_PATH}` });

    expect(
      audit.receipt([{ status: 500, path: LOGOUT_PATH }])
        .unexpectedFailedResponses,
    ).toBe(1);
  });

  it('메서드까지 지정하면 다른 메서드의 같은 상태·경로는 실패로 남긴다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({
      status: 500,
      url: `${ORIGIN}${PROFILE_PATH}`,
      method: 'GET',
    });

    const receipt = audit.receipt([
      { status: 500, path: PROFILE_PATH, method: 'PATCH' },
    ]);

    expect(receipt.unexpectedFailedResponses).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('메서드를 생략하면 그 상태·경로의 어떤 메서드든 통과시킨다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({
      status: 500,
      url: `${ORIGIN}${PROFILE_PATH}`,
      method: 'GET',
    });

    expect(audit.receipt([{ status: 500, path: PROFILE_PATH }]).clean).toBe(
      true,
    );
  });

  it('허용 목록이 비면 어떤 실패 응답도 통과하지 않는다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({ status: 500, url: `${ORIGIN}${LOGOUT_PATH}` });

    expect(audit.receipt().unexpectedFailedResponses).toBe(1);
    expect(() => audit.assertClean()).toThrow();
  });
});

describe('browser audit — 허용 목록은 다른 오류 검사를 느슨하게 하지 않는다', () => {
  const ALLOW_LOGOUT_500 = [{ status: 500, path: LOGOUT_PATH }] as const;

  it('페이지 오류는 허용 목록과 무관하게 실패다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitPageError('합성 렌더 오류');

    const receipt = audit.receipt(ALLOW_LOGOUT_500);

    expect(receipt.pageErrors).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('리소스 오류가 아닌 콘솔 오류는 허용 목록과 무관하게 실패다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitConsoleError('합성 애플리케이션 오류', `${ORIGIN}${LOGOUT_PATH}`);

    const receipt = audit.receipt(ALLOW_LOGOUT_500);

    expect(receipt.consoleErrors).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('취소가 아닌 요청 실패는 허용 목록과 무관하게 실패다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitRequestFailure({
      method: 'GET',
      url: `${ORIGIN}${LOGOUT_PATH}`,
      errorText: 'net::ERR_CONNECTION_REFUSED',
    });

    const receipt = audit.receipt(ALLOW_LOGOUT_500);

    expect(receipt.requestFailures).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('취소된 요청은 그대로 무시한다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitRequestFailure({
      method: 'GET',
      url: `${ORIGIN}/_next/image`,
      errorText: 'net::ERR_ABORTED',
    });

    expect(audit.receipt().clean).toBe(true);
  });
});

describe('browser audit — URL을 읽지 못한 신호는 구조상 통과할 수 없다', () => {
  const UNPARSEABLE = 'not a url';

  it('읽지 못한 URL의 실패 응답은 허용 목록이 그 문자열을 그대로 적어도 실패로 남는다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({ status: 500, url: UNPARSEABLE, method: 'GET' });

    const receipt = audit.receipt([{ status: 500, path: UNPARSEABLE }]);

    expect(receipt.unexpectedFailedResponses).toBe(1);
    expect(receipt.allowedFailedResponses).toEqual([]);
    expect(receipt.clean).toBe(false);
    expect(() =>
      audit.assertClean([{ status: 500, path: UNPARSEABLE }]),
    ).toThrow();
  });

  it('읽지 못한 URL의 콘솔 리소스 오류도 같은 이유로 실패로 남는다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitConsoleResourceError({ status: 500, url: '' });

    const receipt = audit.receipt([{ status: 500, path: '' }]);

    expect(receipt.consoleErrors).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('읽지 못한 신호가 섞여도 의도한 실패는 그대로 통과시킨다', () => {
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({
      status: 500,
      url: `${ORIGIN}${LOGOUT_PATH}`,
      method: 'POST',
    });
    sink.emitFailedResponse({ status: 500, url: UNPARSEABLE, method: 'GET' });

    const receipt = audit.receipt([
      { status: 500, path: LOGOUT_PATH, method: 'POST' },
    ]);

    expect(receipt.allowedFailedResponses).toEqual([
      { status: 500, path: LOGOUT_PATH },
    ]);
    expect(receipt.unexpectedFailedResponses).toBe(1);
    expect(receipt.clean).toBe(false);
  });
});
