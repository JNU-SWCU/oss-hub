import type { NextConfig } from 'next';
import { join } from 'node:path';
import { backendOrigin } from './backend-origin';

function requireProductionVercelOriginBasicAuth(): void {
  if (process.env.VERCEL_ENV !== 'production') {
    return;
  }

  const credential = process.env.ORIGIN_BASIC_AUTH;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(credential ?? '');
  if (match === null || match[1].length % 4 !== 0) {
    throw new Error(
      'production Vercel에는 유효한 ORIGIN_BASIC_AUTH가 필요합니다.',
    );
  }

  const encoded = match[1];
  const decoded = Buffer.from(encoded, 'base64');
  const decodedCredential = decoded.toString('utf8');
  if (
    decoded.toString('base64') !== encoded ||
    !/^vercel:[A-Za-z0-9+/_-]{32,}={0,2}$/.test(decodedCredential)
  ) {
    throw new Error(
      'production Vercel에는 유효한 ORIGIN_BASIC_AUTH가 필요합니다.',
    );
  }
}

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingIncludes: { '/': ['./backend-origin.allowlist'] },
  poweredByHeader: false,

  eslint: { ignoreDuringBuilds: true },

  devIndicators: { position: 'bottom-right' },
  async rewrites() {
    requireProductionVercelOriginBasicAuth();

    return await Promise.resolve([
      {
        source: '/api/v1/:path*',
        destination: `${backendOrigin(join(__dirname, 'backend-origin.allowlist'))}/api/v1/:path*`,
      },
    ]);
  },
};

export default nextConfig;
