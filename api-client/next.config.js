/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'),
  async rewrites() {
    const core = process.env.CORE_SERVER_URL || process.env.NEXT_PUBLIC_CORE_URL || 'http://localhost:8000';
    return [{ source: '/core-api/:path*', destination: `${core}/:path*` }];
  },
  experimental: {
    devtoolSegmentExplorer: false,
  },
};

export default nextConfig;
