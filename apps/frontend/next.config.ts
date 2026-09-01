import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NextConfig } from 'next';
import {
  LOCAL_REVIEW_FIXTURE_COOKIE,
  LOCAL_REVIEW_FIXTURE_PATTERN,
  LOCAL_REVIEW_LOOPBACK_HOST_PATTERN,
  isLocalReviewRuntime,
} from './src/lib/local-review-runtime';

// 승인된 rewrite 대상 origin의 SHA-256 digest allowlist. 구문만 유효한 임의 HTTPS
// origin으로는 production 빌드가 성공하지 않는다 — 승인 변경은 이 파일의 reviewable diff다.
function approvedBackendOriginDigests(): Set<string> {
  const source = readFileSync(
    join(__dirname, 'backend-origin.allowlist'),
    'utf8',
  );
  const digests = source
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'));
  if (
    digests.length === 0 ||
    digests.some((digest) => !/^[0-9a-f]{64}$/.test(digest))
  ) {
    throw new Error('backend-origin.allowlist가 손상됐습니다.');
  }
  return new Set(digests);
}

function requireProductionBackendOrigin(): string {
  const raw = process.env.BACKEND_ORIGIN?.trim();
  if (!raw) {
    throw new Error('production build에는 BACKEND_ORIGIN이 필요합니다.');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('BACKEND_ORIGIN은 HTTPS origin이어야 합니다.');
  }

  const authority = raw.slice(raw.indexOf('://') + 3).split('/', 1)[0] ?? '';
  if (
    url.protocol !== 'https:' ||
    url.username !== '' ||
    url.password !== '' ||
    authority.includes('@') ||
    raw.includes('?') ||
    raw.includes('#') ||
    url.pathname !== '/'
  ) {
    throw new Error('BACKEND_ORIGIN은 HTTPS origin이어야 합니다.');
  }

  // 승인 경로는 둘이다: 공개-safe digest allowlist 파일, 또는 보호된 빌드 환경의
  // 단일 digest(BACKEND_ORIGIN_APPROVED_SHA256). 후자는 공개 저장소에 네트워크
  // 식별자(역산 가능한 digest 포함)를 남길 수 없는 ingress origin을 위한 경로다.
  const digest = createHash('sha256').update(url.origin).digest('hex');
  const protectedDigest = process.env.BACKEND_ORIGIN_APPROVED_SHA256?.trim();
  const protectedDigestValid =
    protectedDigest !== undefined && /^[0-9a-f]{64}$/.test(protectedDigest);
  if (protectedDigest !== undefined && !protectedDigestValid) {
    throw new Error('BACKEND_ORIGIN_APPROVED_SHA256가 손상됐습니다.');
  }
  if (
    !approvedBackendOriginDigests().has(digest) &&
    !(protectedDigestValid && digest === protectedDigest)
  ) {
    throw new Error('BACKEND_ORIGIN이 승인된 rewrite 대상이 아닙니다.');
  }

  return url.origin;
}

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  // Next 개발 서버가 띄우는 동그란 표시(`<nextjs-portal>`)를 오른쪽 아래로 옮긴다.
  // 기본 자리(왼쪽 아래)가 푸터·고정 UI와 겹칠 수 있어 검토 시 자리를 비킨다.
  // 배포본에는 없는 개발 도구이며, 빌드 오류 표시라 끄지는 않는다.
  devIndicators: { position: 'bottom-right' },
  async rewrites() {
    const development = process.env.NODE_ENV === 'development';
    const backendOrigin = development
      ? (process.env.BACKEND_ORIGIN ?? 'http://localhost:4000').replace(
          /\/$/,
          '',
        )
      : requireProductionBackendOrigin();

    const backendRewrite = {
      source: '/api/v1/:path*',
      destination: `${backendOrigin}/api/v1/:path*`,
    };

    if (
      !development ||
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
