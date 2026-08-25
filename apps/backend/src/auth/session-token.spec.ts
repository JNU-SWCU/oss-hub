import { randomBytes } from 'node:crypto';
import { decodeJwt, SignJWT } from 'jose';
import {
  SESSION_MAX_AGE_SECONDS,
  issueSessionToken,
  verifySessionToken,
} from './session-token';

const secret = new Uint8Array(randomBytes(32));
const otherSecret = new Uint8Array(randomBytes(32));
const githubId = 9007199254740993n; // Number로는 표현 불가한 값 — BigInt 경로 검증
const validProfileIssuedAt = 4_000_000_000;

function signSessionProfile(
  payload: Readonly<Record<string, unknown>>,
): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(githubId.toString(10))
    .setIssuer('oss-hub')
    .setAudience('oss-hub-web')
    .setIssuedAt(validProfileIssuedAt)
    .setExpirationTime(validProfileIssuedAt + 60)
    .sign(secret);
}

describe('session-token', () => {
  it('발급 → 검증 왕복에서 githubId가 보존된다 (2^53 초과 값 포함)', async () => {
    const token = await issueSessionToken(secret, githubId, 0);
    await expect(verifySessionToken(secret, token)).resolves.toEqual({
      githubId,
      sessionVersion: 0,
    });
  });

  it.each([
    ['없음', {}],
    ['소수', { sessionVersion: 1.5 }],
    ['음수', { sessionVersion: -1 }],
    ['문자열', { sessionVersion: '1' }],
  ])(
    'sessionVersion이 %s이면 서명이 유효해도 거부한다',
    async (_label, payload) => {
      const token = await signSessionProfile(payload);

      await expect(verifySessionToken(secret, token)).resolves.toBeNull();
    },
  );

  it('0 이상의 정수 sessionVersion claim은 검증한다', async () => {
    const token = await signSessionProfile({ sessionVersion: 7 });

    await expect(verifySessionToken(secret, token)).resolves.toEqual({
      githubId,
      sessionVersion: 7,
    });
  });

  it('새로 발급한 토큰은 전달된 0 이상의 정수 sessionVersion을 싣는다', async () => {
    const sessionVersion = 7;

    const token = await issueSessionToken(secret, githubId, sessionVersion);
    const issuedVersion = decodeJwt(token).sessionVersion;

    expect(issuedVersion).toBe(sessionVersion);
    expect(Number.isInteger(issuedVersion)).toBe(true);
    expect(issuedVersion).toBeGreaterThanOrEqual(0);
  });

  it('발급 시 sessionVersion 누락은 runtime에서도 거부한다', async () => {
    await expect(
      Reflect.apply(issueSessionToken, undefined, [secret, githubId]),
    ).rejects.toThrow('sessionVersion must be a nonnegative integer');
  });

  it('다른 키로 서명된 토큰은 거부한다', async () => {
    const token = await issueSessionToken(otherSecret, githubId, 0);
    await expect(verifySessionToken(secret, token)).resolves.toBeNull();
  });

  it('각 segment 변조를 거부한다', async () => {
    const token = await issueSessionToken(secret, githubId, 0);
    const [header = '', payload = '', signature = ''] = token.split('.');
    // 마지막 base64url 문자는 padding에 쓰이지 않는 bit만 바뀔 수 있다.
    // 첫 문자를 바꿔 디코딩된 바이트가 반드시 달라지게 한다.
    const tamper = (value: string): string =>
      (value.startsWith('A') ? 'B' : 'A') + value.slice(1);
    for (const tampered of [
      `${tamper(header)}.${payload}.${signature}`,
      `${header}.${tamper(payload)}.${signature}`,
      `${header}.${payload}.${tamper(signature)}`,
      `${header}.${payload}`,
      '',
    ]) {
      await expect(verifySessionToken(secret, tampered)).resolves.toBeNull();
    }
  });

  it('만료된 토큰을 거부한다', async () => {
    const past = Math.floor(Date.now() / 1000) - SESSION_MAX_AGE_SECONDS - 60;
    const token = await issueSessionToken(secret, githubId, 0, past);
    await expect(verifySessionToken(secret, token)).resolves.toBeNull();
  });

  it('서명이 유효해도 profile 위반은 거부한다 — 잘못된 iss/aud, 비정수 sub, 7일 초과 수명', async () => {
    const now = Math.floor(Date.now() / 1000);
    const build = (mutate: (jwt: SignJWT) => SignJWT): Promise<string> =>
      mutate(
        new SignJWT({})
          .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
          .setSubject('123')
          .setIssuer('oss-hub')
          .setAudience('oss-hub-web')
          .setIssuedAt(now)
          .setExpirationTime(now + 60),
      ).sign(secret);

    const wrongIssuer = await build((jwt) => jwt.setIssuer('other'));
    const wrongAudience = await build((jwt) => jwt.setAudience('other'));
    const nonNumericSub = await build((jwt) => jwt.setSubject('abc'));
    const negativeSub = await build((jwt) => jwt.setSubject('-1'));
    const tooLongLife = await build((jwt) =>
      jwt.setExpirationTime(now + SESSION_MAX_AGE_SECONDS + 3600),
    );

    for (const token of [
      wrongIssuer,
      wrongAudience,
      nonNumericSub,
      negativeSub,
      tooLongLife,
    ]) {
      await expect(verifySessionToken(secret, token)).resolves.toBeNull();
    }
  });
});
