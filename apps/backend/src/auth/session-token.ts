import { SignJWT, jwtVerify } from 'jose';

/**
 * 세션 토큰 profile (고정):
 * - HS256만 허용, 클레임은 sub/iss/aud/iat/exp만 사용
 * - sub = githubId의 10진 문자열 (Number 변환 금지 — BigInt로만 다룬다)
 * - 수명 7일 초과 토큰은 서명이 유효해도 거부
 */
const ISSUER = 'oss-hub';
const AUDIENCE = 'oss-hub-web';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

const SUB_RE = /^[0-9]{1,19}$/;

export async function issueSessionToken(
  secret: Uint8Array,
  githubId: bigint,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): Promise<string> {
  return new SignJWT({})
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
): Promise<bigint | null> {
  try {
    const { payload } = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ['sub', 'iat', 'exp'],
      clockTolerance: 5,
    });
    const { sub, iat, exp } = payload;
    if (typeof sub !== 'string' || !SUB_RE.test(sub)) {
      return null;
    }
    if (typeof iat !== 'number' || typeof exp !== 'number') {
      return null;
    }
    if (exp - iat > SESSION_MAX_AGE_SECONDS) {
      return null;
    }
    return BigInt(sub);
  } catch {
    return null;
  }
}
