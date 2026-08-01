import type { NextConfig } from 'next';
import {
  LOCAL_REVIEW_FIXTURE_COOKIE,
  LOCAL_REVIEW_FIXTURE_PATTERN,
  LOCAL_REVIEW_LOOPBACK_HOST_PATTERN,
  isLocalReviewRuntime,
} from './src/app/_local-review/fixture-contract';

const nextConfig: NextConfig = {
  output: 'standalone',
  // Next 개발 서버가 띄우는 동그란 표시(`<nextjs-portal>`)를 오른쪽 아래로 옮긴다.
  // 기본 자리인 왼쪽 아래가 사이드바 맨 아래의 "전남대학교 / SW중심대학사업단"을
  // 정확히 덮어, 사이드바를 쓰는 모든 화면에서 그 글자가 가려졌다. 배포본에는
  // 존재하지 않는 개발 도구지만 검토는 개발 서버로 하므로 자리만 비켜 준다 —
  // 끄지는 않는다. 빌드 오류를 알려 주는 표시라 없으면 그것대로 손해다.
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
