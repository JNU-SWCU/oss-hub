import { afterEach, describe, expect, it, vi } from 'vitest';
import nextConfig from './next.config';

const getRewrites = async () => {
  if (nextConfig.rewrites === undefined) {
    throw new Error('rewrite 설정이 필요합니다.');
  }

  return nextConfig.rewrites();
};

describe('nextConfig rewrites', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('개발 환경에서 기본 backend origin으로 API 요청을 rewrite한다', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BACKEND_ORIGIN', undefined);

    await expect(getRewrites()).resolves.toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:4000/api/v1/:path*',
      },
    ]);
  });

  it('production에서는 HTTPS backend origin으로 API 요청을 rewrite한다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BACKEND_ORIGIN', 'https://backend.example.test/');

    await expect(getRewrites()).resolves.toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'https://backend.example.test/api/v1/:path*',
      },
    ]);
  });

  it('production에서 BACKEND_ORIGIN 누락을 거부한다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BACKEND_ORIGIN', undefined);

    await expect(getRewrites()).rejects.toThrow('BACKEND_ORIGIN');
  });

  it.each([
    'http://backend.example.test',
    'https://backend.example.test/path',
    'https://backend.example.test?',
    'https://backend.example.test#',
    'https://user@backend.example.test',
    'not-an-origin',
  ])(
    'production에서 canonical HTTPS origin이 아닌 값을 거부한다: %s',
    async (origin) => {
      vi.stubEnv('NODE_ENV', 'production');
      vi.stubEnv('BACKEND_ORIGIN', origin);

      await expect(getRewrites()).rejects.toThrow('BACKEND_ORIGIN');
    },
  );

  it('개발 환경에서 BACKEND_ORIGIN을 사용한다', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BACKEND_ORIGIN', 'http://backend:4000/');

    await expect(getRewrites()).resolves.toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'http://backend:4000/api/v1/:path*',
      },
    ]);
  });

  it('명시적으로 켠 로컬 개발에서만 fixture cookie 요청을 앱 내부 adapter로 보낸다', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    vi.stubEnv('BACKEND_ORIGIN', 'http://localhost:4000');
    vi.stubEnv('OSS_HUB_LOCAL_REVIEW_FIXTURES', '1');

    const rewrites = await getRewrites();
    expect(rewrites).toEqual({
      beforeFiles: [
        {
          source: '/api/v1/:path*',
          has: [
            {
              type: 'host',
              value: '(?:localhost|127\\.0\\.0\\.1)',
            },
            {
              type: 'cookie',
              key: 'oss_hub_local_review_fixture',
              value:
                '(?:anonymous|student|staff|admin|settings|loading|error|error-once|unassigned|wrong-role|role-pending|role-rejected|insights-long|insights-zero|insights-empty|insights-unregistered)',
            },
          ],
          destination: '/local-review-api/:path*',
        },
      ],
      afterFiles: [],
      fallback: [
        {
          source: '/api/v1/:path*',
          destination: 'http://localhost:4000/api/v1/:path*',
        },
      ],
    });
    if (Array.isArray(rewrites)) {
      throw new Error('fixture rewrite groups 설정이 필요합니다.');
    }
    const cookieRewrite = rewrites.beforeFiles?.[0];
    if (
      cookieRewrite === undefined ||
      !('has' in cookieRewrite) ||
      cookieRewrite.has === undefined
    ) {
      throw new Error('fixture cookie rewrite 설정이 필요합니다.');
    }
    const cookieMatcher = cookieRewrite.has[1];
    if (cookieMatcher === undefined || cookieMatcher.type !== 'cookie') {
      throw new Error('fixture cookie matcher 설정이 필요합니다.');
    }
    expect(new RegExp(`^${cookieMatcher.value}$`).test('insights-long')).toBe(
      true,
    );
    expect(
      new RegExp(`^${cookieMatcher.value}$`).test('arbitrary-fixture'),
    ).toBe(false);
  });

  it('production에서는 fixture flag가 있어도 external backend rewrite만 만든다', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('BACKEND_ORIGIN', 'https://backend.example.test');
    vi.stubEnv('OSS_HUB_LOCAL_REVIEW_FIXTURES', '1');

    await expect(getRewrites()).resolves.toEqual([
      {
        source: '/api/v1/:path*',
        destination: 'https://backend.example.test/api/v1/:path*',
      },
    ]);
  });
});

describe('nextConfig poweredByHeader', () => {
  it('X-Powered-By 배너를 끈다', () => {
    expect(nextConfig.poweredByHeader).toBe(false);
  });
});
