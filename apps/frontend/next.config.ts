import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }

    const backendOrigin = (
      process.env.BACKEND_ORIGIN ?? 'http://localhost:4000'
    ).replace(/\/$/, '');

    // baseURL의 단일 소유자는 api-client이며, rewrite는 개발 환경의 라우팅만 담당한다.
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendOrigin}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
