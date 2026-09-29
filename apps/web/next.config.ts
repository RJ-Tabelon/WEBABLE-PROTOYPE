import type { NextConfig } from 'next';

const config: NextConfig = {
  // Each parallel dev/build process can use its own output directory.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  transpilePackages: ['@webable/core', '@webable/ui', '@webable/tokens'],
  poweredByHeader: false,
};

export default config;
