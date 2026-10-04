import type { NextRequest } from 'next/server';

import { updateSession } from './lib/supabase/proxy';

/**
 * Next.js 16 proxy: refreshes the Supabase session cookie on each page request
 * and sends signed-out visitors of /app/** and /connect to /sign-in?next=...
 */
export async function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except build output, image optimization, fonts, and static files
     * (favicon, images, fonts, scripts, styles, manifests, robots, sitemaps).
     */
    '/((?!_next/static|_next/image|fonts/|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff|woff2|ttf|otf|css|js|map|txt|xml|webmanifest)$).*)',
  ],
};
