import { MemberKind } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { decodeJwt, SignJWT } from 'jose';
import {
  selectGithubPrimaryEmail,
  loginLandingUrl,
  createFlowState,
  decodeFlowCookie,
  encodeFlowCookie,
  isSameState,
  toCodeChallenge,
  SESSION_MAX_AGE_SECONDS,
  issueSessionToken,
  verifySessionToken,
} from './auth.service';

describe('github-primary-email', () => {
  describe('selectGithubPrimaryEmail', () => {
    it('primary+verified를 최우선으로 고른다', () => {
      expect(
        selectGithubPrimaryEmail([
          { email: 'other@example.com', primary: false, verified: true },
          { email: 'primary@example.com', primary: true, verified: true },
          { email: 'unverified@example.com', primary: true, verified: false },
        ]),
      ).toBe('primary@example.com');
    });

    it('primary+verified가 없으면 primary를 고른다', () => {
      expect(
        selectGithubPrimaryEmail([
          { email: 'verified@example.com', primary: false, verified: true },
          { email: 'primary@example.com', primary: true, verified: false },
        ]),
      ).toBe('primary@example.com');
    });

    it('primary가 없으면 첫 verified를 고른다', () => {
      expect(
        selectGithubPrimaryEmail([
          { email: 'first@example.com', primary: false, verified: true },
          { email: 'second@example.com', primary: false, verified: true },
        ]),
      ).toBe('first@example.com');
    });

    it('후보가 없으면 null이다', () => {
      expect(
        selectGithubPrimaryEmail([
          { email: 'a@example.com', primary: false, verified: false },
        ]),
      ).toBeNull();
      expect(selectGithubPrimaryEmail([])).toBeNull();
    });
  });
});

describe('login-landing', () => {
  describe('loginLandingUrl', () => {
    const frontendUrl = 'https://oss.example';
    const onboardingEntry = `${frontendUrl}/consent`;

    const UNSETTLED = {
      memberKind: null,
      hasStaffAccess: false,
      hasAdminAccess: false,
    } as const;

    const SETTLED_IDENTITIES = [
      ['STUDENT', { ...UNSETTLED, memberKind: MemberKind.STUDENT }],
      [
        'STAFF',
        { ...UNSETTLED, memberKind: MemberKind.STAFF, hasStaffAccess: true },
      ],
      ['ADMIN', { ...UNSETTLED, hasAdminAccess: true }],
      [
        'STUDENT-ADMIN',
        { ...UNSETTLED, memberKind: MemberKind.STUDENT, hasAdminAccess: true },
      ],
    ] as const;

    it.each(SETTLED_IDENTITIES)(
      '온보딩을 마친 %s 재로그인 사용자는 랜딩으로 보낸다',
      (_label, identity) => {
        expect(
          loginLandingUrl(frontendUrl, {
            user: { ...identity, isProfileComplete: true },
            isNew: false,
          }),
        ).toBe(frontendUrl);
      },
    );

    it('접근 권한이 없는 완료된 STAFF는 온보딩 입구로 돌아간다', () => {
      expect(
        loginLandingUrl(frontendUrl, {
          user: {
            memberKind: MemberKind.STAFF,
            hasStaffAccess: false,
            hasAdminAccess: false,
            isProfileComplete: true,
          },
          isNew: false,
        }),
      ).toBe(onboardingEntry);
    });

    it('확정된 사실이 하나도 없으면 온보딩 입구로 보낸다', () => {
      expect(
        loginLandingUrl(frontendUrl, {
          user: { ...UNSETTLED, isProfileComplete: false },
          isNew: false,
        }),
      ).toBe(onboardingEntry);
    });

    it('신규 가입자는 온보딩 입구로 보낸다', () => {
      expect(
        loginLandingUrl(frontendUrl, {
          user: { ...UNSETTLED, isProfileComplete: false },
          isNew: true,
        }),
      ).toBe(onboardingEntry);
    });

    it.each(SETTLED_IDENTITIES)(
      '초기 시드로 %s이 설정된 신규 가입자도 온보딩 입구를 거친다',
      (_label, identity) => {
        expect(
          loginLandingUrl(frontendUrl, {
            user: { ...identity, isProfileComplete: true },
            isNew: true,
          }),
        ).toBe(onboardingEntry);
      },
    );

    it.each(SETTLED_IDENTITIES)(
      '확정된 사실이 있어도 프로필이 미완료인 %s는 온보딩 입구로 보낸다',
      (_label, identity) => {
        expect(
          loginLandingUrl(frontendUrl, {
            user: { ...identity, isProfileComplete: false },
            isNew: false,
          }),
        ).toBe(onboardingEntry);
      },
    );

    it('frontendUrl 뒤에 경로만 붙이고 출처는 바꾸지 않는다', () => {
      expect(
        loginLandingUrl('https://other.example', {
          user: { ...UNSETTLED, isProfileComplete: false },
          isNew: false,
        }),
      ).toBe('https://other.example/consent');
    });
  });
});

describe('oauth-flow', () => {
  describe('oauth-flow', () => {
    it('생성된 state·verifier는 각각 43자 base64url이다', () => {
      const flow = createFlowState();
      expect(flow.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(flow.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(flow.state).not.toBe(flow.verifier);
    });

    it('encode → decode 왕복이 보존된다', () => {
      const flow = createFlowState();
      expect(decodeFlowCookie(encodeFlowCookie(flow))).toEqual(flow);
    });

    it.each([
      ['undefined', undefined],
      ['빈 문자열', ''],
      ['segment 1개', 'a'.repeat(43)],
      ['segment 3개', `${'a'.repeat(43)}.${'b'.repeat(43)}.${'c'.repeat(43)}`],
      ['길이 42', `${'a'.repeat(42)}.${'b'.repeat(43)}`],
      ['길이 44', `${'a'.repeat(44)}.${'b'.repeat(43)}`],
      ['base64url 밖 문자(+)', `${'a'.repeat(42)}+.${'b'.repeat(43)}`],
      ['padding(=) 포함', `${'a'.repeat(42)}=.${'b'.repeat(43)}`],
    ])('형식 위반 쿠키는 null: %s', (_label, value) => {
      expect(decodeFlowCookie(value)).toBeNull();
    });

    it('state 비교: 동일하면 true, 다르거나 길이가 다르면 false', () => {
      const { state } = createFlowState();
      const mutated = `${state.slice(0, 42)}${state[42] === 'A' ? 'B' : 'A'}`;
      expect(mutated).toHaveLength(43);
      expect(mutated).not.toBe(state);
      expect(isSameState(state, state)).toBe(true);
      expect(isSameState(state, mutated)).toBe(false);
      expect(isSameState(state, state.slice(0, 42))).toBe(false);
    });

    it('code_challenge는 RFC 7636 S256 테스트 벡터와 일치한다', () => {
      expect(
        toCodeChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
      ).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    });
  });
});

describe('session-token', () => {
  const secret = new Uint8Array(randomBytes(32));
  const otherSecret = new Uint8Array(randomBytes(32));
  const githubId = 9007199254740993n;
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
});
