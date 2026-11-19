import type { NextConfig } from 'next';

// '' locally; '/WEBABLE-PROTOYPE' for GitHub Pages (see lib/base-path.ts).
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(/\/+$/, '');

const config: NextConfig = {
  // A static site in out/: GitHub Pages serves it, and the browser talks to
  // Supabase directly (RLS decides what each person can read and write).
  output: 'export',
  ...(basePath ? { basePath } : {}),
  // /privacy/ -> privacy/index.html, which every static host serves.
  trailingSlash: true,
  images: { unoptimized: true },
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
