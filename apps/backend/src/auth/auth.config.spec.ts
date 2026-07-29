import { randomBytes } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { AuthConfig } from './auth.config';

const BASE_ENV = { ...process.env };
const AUTH_ENV_KEYS = [
  'NODE_ENV',
  'SESSION_SECRET',
  'FRONTEND_URL',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'GITHUB_OAUTH_CALLBACK_URL',
  'AUTH_INITIAL_ROLES',
] as const;

function withEnv(env: NodeJS.ProcessEnv, run: () => void): void {
  process.env = { ...BASE_ENV };
  for (const key of AUTH_ENV_KEYS) {
    delete process.env[key];
  }
  Object.assign(process.env, env);
  try {
    run();
  } finally {
    process.env = { ...BASE_ENV };
  }
}

function sessionSecret(): string {
  return randomBytes(32).toString('base64url');
}

function credentialUrl(pathname = ''): string {
  const url = new URL('https://oss.example');
  url.pathname = pathname;
  url.username = 'synthetic-user';
  url.password = 'synthetic-password';
  return url.toString();
}

function requiredAuthEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    SESSION_SECRET: sessionSecret(),
    FRONTEND_URL: 'https://oss.example',
    GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
    GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
    ...overrides,
  };
}

describe('AuthConfig', () => {
  it('FRONTEND_URL을 canonical public origin으로 고정하고 callback을 같은 origin에서 파생한다', () => {
    withEnv(requiredAuthEnv(), () => {
      const config = new AuthConfig();

      expect(config.frontendUrl).toBe('https://oss.example');
      expect(config.allowedOrigin).toBe('https://oss.example');
      expect(config.requireOauth().callbackUrl).toBe(
        'https://oss.example/api/v1/auth/github/callback',
      );
    });
  });

  it.each([
    ['credentials', credentialUrl()],
    ['query', 'https://oss.example?x=1'],
    ['hash', 'https://oss.example#frag'],
    ['path', 'https://oss.example/app'],
    ['non-http', 'ftp://oss.example'],
    // present-empty components: WHATWG getters collapse these to empty strings.
    ['empty-query', 'https://oss.example?'],
    ['empty-hash', 'https://oss.example#'],
    ['empty-query-hash', 'https://oss.example?#'],
    ['empty-userinfo', 'https://@oss.example'],
    ['empty-userinfo-with-colon', 'https://:@oss.example'],
    ['slashless-empty-query', 'https:oss.example?'],
    ['slashless-empty-userinfo', 'https:@oss.example'],
    ['backslash-empty-query', 'https:\\\\oss.example?'],
  ])(
    'FRONTEND_URL이 canonical origin이 아니면 거부한다: %s',
    (_label, frontendUrl) => {
      withEnv(requiredAuthEnv({ FRONTEND_URL: frontendUrl }), () => {
        expect(() => new AuthConfig()).toThrow();
      });
    },
  );
  it.each([
    // percent-encoded path-looking octets must not be treated as query/hash delimiters,
    // but a path still disqualifies a canonical origin.
    ['percent-encoded-question', 'https://oss.example/%3Fnot-query'],
    ['percent-encoded-hash', 'https://oss.example/%23not-hash'],
  ])(
    'FRONTEND_URL path with percent-encoded delimiter octets is still rejected as non-origin: %s',
    (_label, frontendUrl) => {
      withEnv(requiredAuthEnv({ FRONTEND_URL: frontendUrl }), () => {
        expect(() => new AuthConfig()).toThrow('FRONTEND_URL');
      });
    },
  );

  it.each([
    ['absent', undefined],
    ['development', 'development'],
    ['production', 'production'],
  ])(
    'HTTP FRONTEND_URL을 허용하고 useSecureCookies=false다 (NODE_ENV=%s)',
    (_label, nodeEnv) => {
      withEnv(
        requiredAuthEnv({
          NODE_ENV: nodeEnv,
          FRONTEND_URL: 'http://oss.example',
        }),
        () => {
          const config = new AuthConfig();
          expect(config.frontendUrl).toBe('http://oss.example');
          expect(config.useSecureCookies).toBe(false);
        },
      );
    },
  );

  it.each([
    ['absent', undefined],
    ['development', 'development'],
    ['production', 'production'],
  ])(
    'HTTPS FRONTEND_URL이면 useSecureCookies=true다 (NODE_ENV=%s)',
    (_label, nodeEnv) => {
      withEnv(
        requiredAuthEnv({
          NODE_ENV: nodeEnv,
          FRONTEND_URL: 'https://oss.example',
        }),
        () => {
          expect(new AuthConfig().useSecureCookies).toBe(true);
        },
      );
    },
  );

  it.each([
    ['cross-origin', 'https://evil.example/api/v1/auth/github/callback'],
    ['unexpected path', 'https://oss.example/api/v1/auth/github/other'],
    ['query', 'https://oss.example/api/v1/auth/github/callback?code=value'],
    ['hash', 'https://oss.example/api/v1/auth/github/callback#fragment'],
    ['credentials', credentialUrl('/api/v1/auth/github/callback')],
    ['non-http', 'ftp://oss.example/api/v1/auth/github/callback'],
    // present-empty components must not equal the derived callback after WHATWG normalization.
    ['empty-query', 'https://oss.example/api/v1/auth/github/callback?'],
    ['empty-hash', 'https://oss.example/api/v1/auth/github/callback#'],
    ['empty-userinfo', 'https://@oss.example/api/v1/auth/github/callback'],
    [
      'empty-userinfo-with-colon',
      'https://:@oss.example/api/v1/auth/github/callback',
    ],
  ])(
    'configured callback이 canonical callback이 아니면 거부한다: %s',
    (_label, callbackUrl) => {
      withEnv(
        requiredAuthEnv({ GITHUB_OAUTH_CALLBACK_URL: callbackUrl }),
        () => {
          expect(() => new AuthConfig()).toThrow('GITHUB_OAUTH_CALLBACK_URL');
        },
      );
    },
  );

  it('configured callback placeholder 빈 값은 허용하고 파생 callback을 사용한다', () => {
    withEnv(requiredAuthEnv({ GITHUB_OAUTH_CALLBACK_URL: '' }), () => {
      expect(new AuthConfig().requireOauth().callbackUrl).toBe(
        'https://oss.example/api/v1/auth/github/callback',
      );
    });
  });

  it.each([
    ['absent', undefined],
    ['development', 'development'],
    ['production', 'production'],
  ])('SESSION_SECRET 누락을 거부한다 (NODE_ENV=%s)', (_label, nodeEnv) => {
    withEnv(
      requiredAuthEnv({
        NODE_ENV: nodeEnv,
        SESSION_SECRET: undefined,
      }),
      () => {
        delete process.env.SESSION_SECRET;
        expect(() => new AuthConfig()).toThrow('SESSION_SECRET');
      },
    );
  });

  it.each([
    ['absent', undefined],
    ['development', 'development'],
    ['production', 'production'],
  ])('FRONTEND_URL 누락을 거부한다 (NODE_ENV=%s)', (_label, nodeEnv) => {
    withEnv(
      requiredAuthEnv({
        NODE_ENV: nodeEnv,
        FRONTEND_URL: undefined,
      }),
      () => {
        delete process.env.FRONTEND_URL;
        expect(() => new AuthConfig()).toThrow('FRONTEND_URL');
      },
    );
  });

  it.each([
    ['absent', undefined],
    ['development', 'development'],
    ['production', 'production'],
  ])(
    'GitHub OAuth client 자격증명 누락을 거부한다 (NODE_ENV=%s)',
    (_label, nodeEnv) => {
      withEnv(
        requiredAuthEnv({
          NODE_ENV: nodeEnv,
          GITHUB_OAUTH_CLIENT_ID: undefined,
          GITHUB_OAUTH_CLIENT_SECRET: undefined,
        }),
        () => {
          delete process.env.GITHUB_OAUTH_CLIENT_ID;
          delete process.env.GITHUB_OAUTH_CLIENT_SECRET;
          expect(() => new AuthConfig()).toThrow('GITHUB_OAUTH_CLIENT');
        },
      );
    },
  );

  it('짧은 SESSION_SECRET을 거부한다', () => {
    withEnv(
      requiredAuthEnv({
        SESSION_SECRET: Buffer.from('too-short').toString('base64url'),
      }),
      () => {
        expect(() => new AuthConfig()).toThrow('SESSION_SECRET');
      },
    );
  });
});

describe('AuthConfig 초기 역할 시드', () => {
  it('설정되면 역할을, 미등록·미설정이면 null을 반환한다', () => {
    withEnv(requiredAuthEnv({ AUTH_INITIAL_ROLES: '101:STAFF' }), () => {
      const config = new AuthConfig();
      expect(config.resolveInitialRole(101n)).toBe('STAFF');
      expect(config.resolveInitialRole(999n)).toBeNull();
    });
    withEnv(requiredAuthEnv(), () => {
      expect(new AuthConfig().resolveInitialRole(101n)).toBeNull();
    });
  });

  it('형식 오류는 생성자에서 즉시 실패한다', () => {
    withEnv(requiredAuthEnv({ AUTH_INITIAL_ROLES: '0:ADMIN' }), () => {
      expect(() => new AuthConfig()).toThrow('AUTH_INITIAL_ROLES');
    });
  });
});

describe('AuthConfig DI', () => {
  it('Nest-managed construction fails when RUNTIME_CONFIG is absent', async () => {
    await expect(
      Test.createTestingModule({
        providers: [AuthConfig],
      }).compile(),
    ).rejects.toThrow(/RUNTIME_CONFIG/);
  });
});
