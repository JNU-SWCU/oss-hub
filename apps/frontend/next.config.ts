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
    imageSizes: [16, 32, 48, 64, 96, 128, 176, 256, 384],
    localPatterns: [{ pathname: '/program-cover-source/*/*', search: '' }],
  },

  eslint: { ignoreDuringBuilds: true },
  experimental: {
    optimizePackageImports: ['radix-ui', '@tanstack/react-query'],
  },

  devIndicators: { position: 'bottom-right' },
  async redirects() {
    return await Promise.resolve([
      { source: '/dashboard/me', destination: '/settings', permanent: true },
      {
        source: '/programs/:id/notifications',
        destination: '/programs/:id',
        permanent: true,
      },
      {
        source: '/programs/:id/milestones/:milestoneId/documents',
        destination: '/programs/:id/documents?milestoneId=:milestoneId',
        permanent: true,
      },
    ]);
  },
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
