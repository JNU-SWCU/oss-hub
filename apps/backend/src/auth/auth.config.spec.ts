import { randomBytes } from 'node:crypto';
import { AuthConfig } from './auth.config';

const BASE_ENV = { ...process.env };
const AUTH_ENV_KEYS = [
  'NODE_ENV',
  'SESSION_SECRET',
  'FRONTEND_URL',
  'GITHUB_OAUTH_CLIENT_ID',
  'GITHUB_OAUTH_CLIENT_SECRET',
  'GITHUB_OAUTH_CALLBACK_URL',
  'AUTH_TEST_ROLE_MAP',
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

describe('AuthConfig', () => {
  it('FRONTEND_URL을 canonical public origin으로 고정하고 callback을 같은 origin에서 파생한다', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        SESSION_SECRET: sessionSecret(),
        FRONTEND_URL: 'https://oss.example',
        GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
        GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
      },
      () => {
        const config = new AuthConfig();

        expect(config.frontendUrl).toBe('https://oss.example');
        expect(config.allowedOrigin).toBe('https://oss.example');
        expect(config.requireOauth().callbackUrl).toBe(
          'https://oss.example/api/v1/auth/github/callback',
        );
      },
    );
  });

  it.each([
    ['credentials', credentialUrl()],
    ['query', 'https://oss.example?x=1'],
    ['hash', 'https://oss.example#frag'],
    ['path', 'https://oss.example/app'],
    ['non-http', 'ftp://oss.example'],
  ])('FRONTEND_URL이 canonical origin이 아니면 거부한다: %s', (_label, frontendUrl) => {
    withEnv(
      {
        NODE_ENV: 'production',
        SESSION_SECRET: sessionSecret(),
        FRONTEND_URL: frontendUrl,
        GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
        GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
      },
      () => {
        expect(() => new AuthConfig()).toThrow();
      },
    );
  });

  it('운영 FRONTEND_URL은 HTTPS만 허용한다', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        SESSION_SECRET: sessionSecret(),
        FRONTEND_URL: 'http://oss.example',
        GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
        GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
      },
      () => {
        expect(() => new AuthConfig()).toThrow('HTTPS');
      },
    );
  });

  it.each([
    ['cross-origin', 'https://evil.example/api/v1/auth/github/callback'],
    ['unexpected path', 'https://oss.example/api/v1/auth/github/other'],
    ['query', 'https://oss.example/api/v1/auth/github/callback?code=value'],
    ['hash', 'https://oss.example/api/v1/auth/github/callback#fragment'],
    [
      'credentials',
      credentialUrl('/api/v1/auth/github/callback'),
    ],
    ['non-http', 'ftp://oss.example/api/v1/auth/github/callback'],
  ])('configured callback이 canonical callback이 아니면 거부한다: %s', (_label, callbackUrl) => {
    withEnv(
      {
        NODE_ENV: 'production',
        SESSION_SECRET: sessionSecret(),
        FRONTEND_URL: 'https://oss.example',
        GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
        GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
        GITHUB_OAUTH_CALLBACK_URL: callbackUrl,
      },
      () => {
        expect(() => new AuthConfig()).toThrow('GITHUB_OAUTH_CALLBACK_URL');
      },
    );
  });

  it('configured callback placeholder 빈 값은 허용하고 파생 callback을 사용한다', () => {
    withEnv(
      {
        NODE_ENV: 'production',
        SESSION_SECRET: sessionSecret(),
        FRONTEND_URL: 'https://oss.example',
        GITHUB_OAUTH_CLIENT_ID: 'synthetic-client-id',
        GITHUB_OAUTH_CLIENT_SECRET: 'synthetic-client-secret',
        GITHUB_OAUTH_CALLBACK_URL: '',
      },
      () => {
        expect(new AuthConfig().requireOauth().callbackUrl).toBe(
          'https://oss.example/api/v1/auth/github/callback',
        );
      },
    );
  });
});

describe('AuthConfig 테스트 역할 매핑 (Issue #65)', () => {
  it('설정되면 역할을, 미등록·미설정이면 null을 반환한다', () => {
    withEnv({ AUTH_TEST_ROLE_MAP: '101:STAFF' }, () => {
      const config = new AuthConfig();
      expect(config.resolveTestRole(101n)).toBe('STAFF');
      expect(config.resolveTestRole(999n)).toBeNull();
    });
    withEnv({}, () => {
      expect(new AuthConfig().resolveTestRole(101n)).toBeNull();
    });
  });
});
