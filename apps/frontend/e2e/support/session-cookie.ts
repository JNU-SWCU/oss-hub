import { createHmac, createHash } from 'node:crypto';

const ISSUER = 'oss-hub';
const AUDIENCE = 'oss-hub-web';
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

function base64UrlEncode(input: Buffer | string): string {
  const buffer = typeof input === 'string' ? Buffer.from(input) : input;
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

const SEED_GITHUB_ID_PREFIX = BigInt('9600000000000000');
const SEED_ID_MODULUS = BigInt('1000000000000');

function seedGithubId(slug: string): bigint {
  const digest = createHash('sha256').update(slug).digest();
  const value = digest.readBigUInt64BE(0) % SEED_ID_MODULUS;
  return SEED_GITHUB_ID_PREFIX + value;
}

export function seedId(...parts: readonly string[]): string {
  return ['seed', ...parts].join(':');
}

export const ADMIN_SEED_USER_ID = seedId('auth', 'admin-confirmed');
export const ADMIN_SEED_GITHUB_ID = seedGithubId(ADMIN_SEED_USER_ID);

export function authSeedGithubId(scenarioId: string): bigint {
  return seedGithubId(seedId('auth', scenarioId));
}

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

export function sessionCookieName(secure: boolean): string {
  return secure ? '__Host-oss_session' : 'oss_session_dev';
}
