import type { NextConfig } from 'next';

const config: NextConfig = {
  // Each parallel dev/build process can use its own output directory.
  distDir: process.env.NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  transpilePackages: ['@webable/core', '@webable/ui', '@webable/tokens'],
  poweredByHeader: false,
  // Do not generate AGENTS.md / CLAUDE.md on `next dev`.
  agentRules: false,
  // Allow the dev server to be reached on 127.0.0.1 as well as localhost.
  allowedDevOrigins: ['127.0.0.1'],
};

export default config;
