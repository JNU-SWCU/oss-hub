import { createHmac, createHash } from 'node:crypto';

/**
 * apps/backend/src/auth/session-token.ts의 issueSessionToken과 완전히 동일한
 * HS256 JWT profile을 이 파일이 독립적으로 재구현한다. jose를 새 frontend
 * devDependency로 들이지 않고, backend 소스에도 손대지 않기 위한 선택이다.
 * 클레임 이름과 값은 backend 원본과 일치시켜야 verifySessionToken을 통과한다.
 */

const ISSUER = 'oss-hub';
const AUDIENCE = 'oss-hub-web';
export const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function base64UrlEncode(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input) : input;
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * apps/backend/prisma/seeds/helpers.ts의 seedGithubId·deterministicBigInt와
 * 동일한 알고리즘 — 같은 slug는 항상 같은 githubId를 만든다. seed.ts가 만든
 * `admin-confirmed` 사용자의 실제 githubId를 재계산해 JWT sub 클레임에 넣는다.
 */
const SEED_GITHUB_ID_PREFIX = BigInt('9600000000000000');
const SEED_ID_MODULUS = BigInt('1000000000000');

export function seedGithubId(slug: string): bigint {
  const digest = createHash('sha256').update(slug).digest();
  const value = digest.readBigUInt64BE(0) % SEED_ID_MODULUS;
  return SEED_GITHUB_ID_PREFIX + value;
}

/** apps/backend/prisma/seeds/helpers.ts의 seedId와 동일한 형식. */
export function seedId(...parts: readonly string[]): string {
  return ['seed', ...parts].join(':');
}

export const ADMIN_SEED_USER_ID = seedId('auth', 'admin-confirmed');
export const ADMIN_SEED_GITHUB_ID = seedGithubId(ADMIN_SEED_USER_ID);

/** auth seed profile의 scenario id로 실제 GitHub id를 재계산한다. */
export function authSeedGithubId(scenarioId: string): bigint {
  return seedGithubId(seedId('auth', scenarioId));
}

/**
 * apps/backend/src/auth/session-token.ts의 issueSessionToken과 바이트 단위로
 * 호환되는 HS256 JWT를 서명한다. sub는 반드시 10진 문자열이어야 한다
 * (verifySessionToken의 SUB_RE = /^[0-9]{1,19}$/).
 */
export function forgeSessionToken(
  sessionSecretBase64Url: string,
  githubId: bigint,
  nowEpochSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sessionVersion: 0,
    sub: githubId.toString(10),
    iss: ISSUER,
    aud: AUDIENCE,
    iat: nowEpochSeconds,
    exp: nowEpochSeconds + SESSION_MAX_AGE_SECONDS,
  };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const secret = Buffer.from(sessionSecretBase64Url, 'base64url');
  const signature = createHmac('sha256', secret).update(signingInput).digest();
  return `${signingInput}.${base64UrlEncode(signature)}`;
}

/**
 * apps/backend/src/auth/cookies.ts의 sessionCookieName과 동일한 규칙.
 * secure=false(HTTP 로컬 스택)일 때는 항상 `oss_session_dev`다.
 */
export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-oss_session' : 'oss_session_dev';
}
