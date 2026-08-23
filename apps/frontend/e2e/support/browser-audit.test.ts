import { describe, expect, it } from 'vitest';

import { installBrowserAudit } from './browser-audit';
import { BrowserEventSink } from './browser-audit-fake-page';

const LOGOUT_PATH = '/api/v1/auth/logout';
const PROFILE_PATH = '/api/v1/users/me/profile';
const ORIGIN = 'http://127.0.0.1:3000';

/**
 * 이 스펙이 잠그는 것은 **의도한 실패 하나만 통과시키는가**다.
 *
 * 허용 목록이 상태 코드만 본다면 `500`을 하나 허용하는 순간 그 실행의 모든 500이
 * 함께 통과한다 — 로그아웃 실패를 재현하려고 연 문으로 관계없는 화면의 서버 오류가
 * 같이 들어온다. 그래서 허용 단위를 `상태 + 경로`(필요하면 메서드까지)로 두고,
 * 같은 상태라도 경로가 다르면 그대로 실패해야 한다.
 */
describe('browser audit 허용 목록 — 상태 + 경로가 정확히 맞을 때만 통과한다', () => {
  it('의도한 상태·경로의 실패 응답은 통과시킨다', () => {
    // Given: 로그아웃 실패 시나리오가 실제로 만드는 두 신호(응답 + 콘솔 오류).
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

    // When
    const receipt = audit.receipt([
      { status: 500, path: LOGOUT_PATH, method: 'POST' },
    ]);

    // Then
    expect(receipt.clean).toBe(true);
    expect(receipt.unexpectedFailedResponses).toBe(0);
    expect(receipt.consoleErrors).toBe(0);
    expect(receipt.allowedFailedResponses).toEqual([
      { status: 500, path: LOGOUT_PATH },
    ]);
  });

  it('허용한 것과 다른 경로의 같은 상태는 실패로 남긴다', () => {
    // Given: 로그아웃 500만 의도했는데 관계없는 경로도 500으로 떨어졌다.
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({ status: 500, url: `${ORIGIN}${LOGOUT_PATH}` });
    sink.emitFailedResponse({ status: 500, url: `${ORIGIN}${PROFILE_PATH}` });

    // When
    const receipt = audit.receipt([{ status: 500, path: LOGOUT_PATH }]);

    // Then: 상태가 같아도 경로가 다르면 통과하지 않는다.
    expect(receipt.unexpectedFailedResponses).toBe(1);
    expect(receipt.clean).toBe(false);
    expect(() =>
      audit.assertClean([{ status: 500, path: LOGOUT_PATH }]),
    ).toThrow();
  });

  it('허용한 것과 다른 경로의 콘솔 리소스 오류도 실패로 남긴다', () => {
    // Given: 콘솔에만 남는 리소스 오류가 허용 경로 밖에서 났다.
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitConsoleResourceError({
      status: 500,
      url: `${ORIGIN}${PROFILE_PATH}`,
    });

    // When
    const receipt = audit.receipt([{ status: 500, path: LOGOUT_PATH }]);

    // Then
    expect(receipt.consoleErrors).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('허용한 것과 다른 상태는 경로가 같아도 실패로 남긴다', () => {
    // Given: 500만 의도했는데 같은 경로가 503으로 떨어졌다.
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({ status: 503, url: `${ORIGIN}${LOGOUT_PATH}` });

    // When / Then
    expect(
      audit.receipt([{ status: 500, path: LOGOUT_PATH }])
        .unexpectedFailedResponses,
    ).toBe(1);
  });

  it('메서드까지 지정하면 다른 메서드의 같은 상태·경로는 실패로 남긴다', () => {
    // Given: 설정 저장 실패는 PATCH만 의도했는데 조회(GET)도 500으로 떨어졌다.
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({
      status: 500,
      url: `${ORIGIN}${PROFILE_PATH}`,
      method: 'GET',
    });

    // When
    const receipt = audit.receipt([
      { status: 500, path: PROFILE_PATH, method: 'PATCH' },
    ]);

    // Then
    expect(receipt.unexpectedFailedResponses).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('메서드를 생략하면 그 상태·경로의 어떤 메서드든 통과시킨다', () => {
    // Given
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({
      status: 500,
      url: `${ORIGIN}${PROFILE_PATH}`,
      method: 'GET',
    });

    // When / Then
    expect(audit.receipt([{ status: 500, path: PROFILE_PATH }]).clean).toBe(
      true,
    );
  });

  it('허용 목록이 비면 어떤 실패 응답도 통과하지 않는다', () => {
    // Given
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({ status: 500, url: `${ORIGIN}${LOGOUT_PATH}` });

    // When / Then
    expect(audit.receipt().unexpectedFailedResponses).toBe(1);
    expect(() => audit.assertClean()).toThrow();
  });
});

describe('browser audit — 허용 목록은 다른 오류 검사를 느슨하게 하지 않는다', () => {
  const ALLOW_LOGOUT_500 = [{ status: 500, path: LOGOUT_PATH }] as const;

  it('페이지 오류는 허용 목록과 무관하게 실패다', () => {
    // Given
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitPageError('합성 렌더 오류');

    // When
    const receipt = audit.receipt(ALLOW_LOGOUT_500);

    // Then
    expect(receipt.pageErrors).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('리소스 오류가 아닌 콘솔 오류는 허용 목록과 무관하게 실패다', () => {
    // Given: 상태 코드를 담지 않은 애플리케이션 콘솔 오류가 허용 경로에서 났다.
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitConsoleError('합성 애플리케이션 오류', `${ORIGIN}${LOGOUT_PATH}`);

    // When
    const receipt = audit.receipt(ALLOW_LOGOUT_500);

    // Then
    expect(receipt.consoleErrors).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('취소가 아닌 요청 실패는 허용 목록과 무관하게 실패다', () => {
    // Given
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitRequestFailure({
      method: 'GET',
      url: `${ORIGIN}${LOGOUT_PATH}`,
      errorText: 'net::ERR_CONNECTION_REFUSED',
    });

    // When
    const receipt = audit.receipt(ALLOW_LOGOUT_500);

    // Then
    expect(receipt.requestFailures).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('취소된 요청은 그대로 무시한다', () => {
    // Given
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitRequestFailure({
      method: 'GET',
      url: `${ORIGIN}/_next/image`,
      errorText: 'net::ERR_ABORTED',
    });

    // When / Then
    expect(audit.receipt().clean).toBe(true);
  });
});

/**
 * 브라우저는 절대 URL이 아닌 신호도 남긴다(문서 밖에서 난 콘솔 오류의 빈 URL 등).
 * 그런 신호는 경로를 읽지 못한 것이므로 허용 대조를 시작조차 하지 않는다 — 받은
 * 문자열을 경로인 척 되돌리면, 허용 목록에 우연히 같은 문자열이 적히는 순간 읽지도
 * 못한 실패가 통과해 버린다. 그래서 아래 두 테스트는 **허용 목록의 `path`를 그 원본
 * 문자열과 똑같이 적어 두고도** 통과하지 못한다는 것을 잠근다.
 */
describe('browser audit — URL을 읽지 못한 신호는 구조상 통과할 수 없다', () => {
  const UNPARSEABLE = 'not a url';

  it('읽지 못한 URL의 실패 응답은 허용 목록이 그 문자열을 그대로 적어도 실패로 남는다', () => {
    // Given: URL을 읽을 수 없는 실패 응답.
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({ status: 500, url: UNPARSEABLE, method: 'GET' });

    // When: 원본 문자열을 경로로 적은 허용 목록으로 대조한다.
    const receipt = audit.receipt([{ status: 500, path: UNPARSEABLE }]);

    // Then: 통과하지 못하고, 허용된 것으로도 세지지 않는다.
    expect(receipt.unexpectedFailedResponses).toBe(1);
    expect(receipt.allowedFailedResponses).toEqual([]);
    expect(receipt.clean).toBe(false);
    expect(() =>
      audit.assertClean([{ status: 500, path: UNPARSEABLE }]),
    ).toThrow();
  });

  it('읽지 못한 URL의 콘솔 리소스 오류도 같은 이유로 실패로 남는다', () => {
    // Given: 소스 프레임이 없어 URL이 빈 콘솔 리소스 오류.
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitConsoleResourceError({ status: 500, url: '' });

    // When: 빈 문자열을 경로로 적은 허용 목록으로 대조한다.
    const receipt = audit.receipt([{ status: 500, path: '' }]);

    // Then
    expect(receipt.consoleErrors).toBe(1);
    expect(receipt.clean).toBe(false);
  });

  it('읽지 못한 신호가 섞여도 의도한 실패는 그대로 통과시킨다', () => {
    // Given: 의도한 로그아웃 500 하나 + URL을 읽지 못한 응답 하나.
    const sink = new BrowserEventSink();
    const audit = installBrowserAudit(sink);
    sink.emitFailedResponse({
      status: 500,
      url: `${ORIGIN}${LOGOUT_PATH}`,
      method: 'POST',
    });
    sink.emitFailedResponse({ status: 500, url: UNPARSEABLE, method: 'GET' });

    // When
    const receipt = audit.receipt([
      { status: 500, path: LOGOUT_PATH, method: 'POST' },
    ]);

    // Then: 의도한 것만 허용되고, 읽지 못한 신호는 실패로 남는다.
    expect(receipt.allowedFailedResponses).toEqual([
      { status: 500, path: LOGOUT_PATH },
    ]);
    expect(receipt.unexpectedFailedResponses).toBe(1);
    expect(receipt.clean).toBe(false);
  });
});
