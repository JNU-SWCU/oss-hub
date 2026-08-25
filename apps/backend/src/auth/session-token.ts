import { SignJWT, jwtVerify } from 'jose';

/**
 * 세션 토큰 profile (고정):
 * - HS256만 허용, 필수 클레임은 sub/iss/aud/iat/exp/sessionVersion
 * - sub = githubId의 10진 문자열 (Number 변환 금지 — BigInt로만 다룬다)
 * - 수명 7일 초과 토큰은 서명이 유효해도 거부
 */
const ISSUER = 'oss-hub';
const AUDIENCE = 'oss-hub-web';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const SUB_RE = /^[0-9]{1,19}$/;

export interface VerifiedSessionToken {
  readonly githubId: bigint;
  readonly sessionVersion: number;
}

function assertSessionVersion(sessionVersion: number): void {
  if (!Number.isInteger(sessionVersion) || sessionVersion < 0) {
    throw new TypeError('sessionVersion must be a nonnegative integer');
  }
}

export async function issueSessionToken(
  secret: Uint8Array,
  githubId: bigint,
  sessionVersion: number,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  assertSessionVersion(sessionVersion);
  return new SignJWT({ sessionVersion })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(githubId.toString(10))
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowEpochSeconds)
    .setExpirationTime(nowEpochSeconds + SESSION_MAX_AGE_SECONDS)
    .sign(secret);
}

/** 검증 실패는 종류와 무관하게 null — 호출부는 전부 동일한 미인증(AUT_003)으로 처리한다. */
export async function verifySessionToken(
  secret: Uint8Array,
  token: string,
): Promise<VerifiedSessionToken | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ['sub', 'iat', 'exp', 'sessionVersion'],
      clockTolerance: 5,
    });
    const { sub, iat, exp, sessionVersion } = payload;
    if (typeof sub !== 'string' || !SUB_RE.test(sub)) {
      return null;
    }
    if (typeof iat !== 'number' || typeof exp !== 'number') {
      return null;
    }
    if (exp - iat > SESSION_MAX_AGE_SECONDS) {
      return null;
    }
    if (
      typeof sessionVersion !== 'number' ||
      !Number.isInteger(sessionVersion) ||
      sessionVersion < 0
    ) {
      return null;
    }
    return { githubId: BigInt(sub), sessionVersion };
  } catch {
    return null;
  }
}
