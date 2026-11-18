import type { NextConfig } from 'next';
import { join } from 'node:path';
import { backendOrigin, originAuthorization } from './backend-origin';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingIncludes: {
    '/': ['./backend-origin.hashes'],
    '/program-cover-source/*/*': ['./backend-origin.hashes'],
  },
  poweredByHeader: false,
  images: {
    localPatterns: [{ pathname: '/program-cover-source/*/*', search: '' }],
  },

  eslint: { ignoreDuringBuilds: true },

  devIndicators: { position: 'bottom-right' },
  async rewrites() {
    originAuthorization();

    return await Promise.resolve([
      {
        source: '/api/v1/:path*',
        destination: `${backendOrigin(join(__dirname, 'backend-origin.hashes'))}/api/v1/:path*`,
      },
    ]);
  },
};

export default nextConfig;
