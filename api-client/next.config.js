/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'),
  experimental: {
    devtoolSegmentExplorer: false,
  },
};

export default nextConfig;
