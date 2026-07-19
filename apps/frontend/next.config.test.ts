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

  it('production에서는 nginx가 라우팅하므로 rewrite하지 않는다', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    await expect(getRewrites()).resolves.toEqual([]);
  });

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
});
