import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // The static site files that share this folder are NOT served by the Next
  // app (only app/ + public/ are). They remain for the static deployment.
  reactStrictMode: true,
  poweredByHeader: false,
  // pg must stay external so the unified API route handlers use the native
  // driver (serverless-safe: point DATABASE_URL at a pooled connection).
  serverExternalPackages: ['pg'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

export default nextConfig;
