import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export interface OauthFlowState {
  state: string;
  verifier: string;
}

const SEGMENT_RE = /^[A-Za-z0-9_-]{43}$/;

export function createFlowState(): OauthFlowState {
  return {
    state: randomBytes(32).toString('base64url'),
    verifier: randomBytes(32).toString('base64url'),
  };
}

export function encodeFlowCookie(flow: OauthFlowState): string {
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

export function toCodeChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}
