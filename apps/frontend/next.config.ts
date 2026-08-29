import type { NextConfig } from 'next';
import {
  LOCAL_REVIEW_FIXTURE_COOKIE,
  LOCAL_REVIEW_FIXTURE_PATTERN,
  LOCAL_REVIEW_LOOPBACK_HOST_PATTERN,
  isLocalReviewRuntime,
} from './src/lib/local-review-runtime';

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Next 개발 서버가 띄우는 동그란 표시(`<nextjs-portal>`)를 오른쪽 아래로 옮긴다.
  // 기본 자리(왼쪽 아래)가 푸터·고정 UI와 겹칠 수 있어 검토 시 자리를 비킨다.
  // 배포본에는 없는 개발 도구이며, 빌드 오류 표시라 끄지는 않는다.
  devIndicators: { position: 'bottom-right' },
  async rewrites() {
    if (process.env.NODE_ENV !== 'development') {
      return [];
    }

    const backendOrigin = (
      process.env.BACKEND_ORIGIN ?? 'http://localhost:4000'
    ).replace(/\/$/, '');

    const backendRewrite = {
      source: '/api/v1/:path*',
      destination: `${backendOrigin}/api/v1/:path*`,
    };

    if (
      !isLocalReviewRuntime({
        nodeEnv: process.env.NODE_ENV,
        enabled: process.env.OSS_HUB_LOCAL_REVIEW_FIXTURES,
        backendOrigin,
      })
    ) {
      return [backendRewrite];
    }

    // fixture cookie가 있고 요청 host도 loopback인 경우에만 내부 adapter가 우선한다.
    // cookie가 없으면 같은 개발 서버에서도 실제 backend rewrite를 그대로 사용한다.
    return {
      beforeFiles: [
        {
          source: '/api/v1/:path*',
          has: [
            {
              type: 'host' as const,
              value: LOCAL_REVIEW_LOOPBACK_HOST_PATTERN,
            },
            {
              type: 'cookie' as const,
              key: LOCAL_REVIEW_FIXTURE_COOKIE,
              value: LOCAL_REVIEW_FIXTURE_PATTERN,
            },
          ],
          destination: '/local-review-api/:path*',
        },
      ],
      afterFiles: [],
      fallback: [backendRewrite],
    };
  },
};

export default nextConfig;
