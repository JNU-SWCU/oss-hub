import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * OAuth 진입 시 만들어 callback에서 소비하는 1회용 값 쌍.
 * 둘 다 서버가 의미를 신뢰하는 데이터가 아니라 브라우저가 다시 제시해야 하는
 * 고엔트로피 capability이므로 서명 없이 쿠키에 보관한다.
 */
export interface OauthFlowState {
  state: string;
  verifier: string;
}

// randomBytes(32).toString('base64url')는 항상 43자다.
const SEGMENT_RE = /^[A-Za-z0-9_-]{43}$/;

export function createFlowState(): OauthFlowState {
  return {
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
  };
}

export function encodeFlowCookie(flow: OauthFlowState): string {
  // '.'은 base64url 알파벳에 없어 구분이 모호하지 않다.
  return `${flow.state}.${flow.verifier}`;
}

export function decodeFlowCookie(
  value: string | undefined,
): OauthFlowState | null {
  if (!value) {
    return null;
  }
  const segments = value.split('.');
  if (segments.length !== 2) {
    return null;
  }
  const [state, verifier] = segments;
  if (state === undefined || verifier === undefined) {
    return null;
  }
  if (!SEGMENT_RE.test(state) || !SEGMENT_RE.test(verifier)) {
    return null;
  }
  return { state, verifier };
}

export function isSameState(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}

/** RFC 7636 S256: challenge = BASE64URL(SHA256(ASCII(verifier))) */
export function toCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
