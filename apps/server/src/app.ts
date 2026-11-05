// The Hono app: guards, routes, demo pages and error mapping. index.ts serves it; dev-check.ts can call it in-process.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { BODY_LIMIT_BYTES } from './config';
import { corsMiddleware, hostGuard, originGuard, rateLimit } from './guard';
import { JevError } from './jev';
import { registerHealth } from './routes/health';
import { registerOverlay } from './routes/overlay';
import { registerReader } from './routes/reader';
import { registerRedesign } from './routes/redesign';
import { registerStruggle } from './routes/struggle';
import { registerUnderstand } from './routes/understand';
import { registerVisual } from './routes/visual';
import { registerReword } from './routes/reword';
import { registerCompose } from './routes/compose';
import { recordRoute } from './stats';
import { HttpError, errorMessage, log, round } from './util';

/** apps/server/demo, or WEBABLE_DEMO_ROOT (absolute) for testing. */
export const DEMO_ROOT = process.env.WEBABLE_DEMO_ROOT || fileURLToPath(new URL('../demo/', import.meta.url));

function jevErrorResponse(c: Context, e: JevError): Response {
  const status = e.kind === 'no_key' ? 503 : e.kind === 'timeout' ? 504 : 502;
  return c.json(
    {
      error: e.kind === 'no_key' ? 'jev_unavailable' : `jev_${e.kind}`,
      message: e.kind === 'no_key' ? 'Jev is not configured on this server.' : 'Jev did not answer, so nothing on the page was changed.',
      status: e.status,
    },
    status,
  );
}

export function createApp(): Hono {
  const app = new Hono();

  // Timing, stats and one log line per API call (never bodies).
  app.use('*', async (c, next) => {
    const t0 = performance.now();
    await next();
    const ms = round(performance.now() - t0);
    const path = c.req.path;
    const route = path.startsWith('/demo') ? '/demo' : path;
    if (c.req.method !== 'OPTIONS') recordRoute(`${c.req.method} ${route}`, c.res.status, ms);
    if (path.startsWith('/v1/') && c.req.method === 'POST') {
      c.res.headers.set('X-WebAble-Ms', String(ms));
      log(`${c.req.method} ${path}`, { status: c.res.status, ms });
    }
  });
  app.use('*', hostGuard);
  app.use('*', corsMiddleware);
  app.use('*', originGuard);
  // Public deployment only (WEBABLE_PUBLIC=1): a per-IP POST limit. A no-op locally.
  app.use('*', rateLimit);
  app.use(
    '/v1/*',
    bodyLimit({
      maxSize: BODY_LIMIT_BYTES,
      onError: (c) => c.json({ error: 'too_large', message: `The request is larger than ${BODY_LIMIT_BYTES / 1024 / 1024} MB.` }, 413),
    }),
  );

  registerHealth(app);
  registerUnderstand(app);
  registerStruggle(app);
  registerRedesign(app);
  registerVisual(app);
  registerOverlay(app);
  registerReader(app);
  registerReword(app);
  registerCompose(app);

  // Demo pages (package F writes apps/server/demo/**).
  if (!existsSync(DEMO_ROOT)) log('demo folder not found yet', { path: 'apps/server/demo' });
  for (const asset of ['favicon.ico', 'favicon.svg', 'apple-touch-icon.png']) {
    app.get(`/${asset}`, serveStatic({ root: DEMO_ROOT, rewriteRequestPath: () => `/brand/${asset}` }));
  }
  app.get('/demo', (c) => c.redirect('/demo/', 302));
  const noStore = (_p: string, c: Context) => {
    c.header('Cache-Control', 'no-store');
  };
  app.use('/demo/*', serveStatic({ root: DEMO_ROOT, rewriteRequestPath: (p) => p.replace(/^\/demo/, '') || '/', onFound: noStore }));
  // Short URLs for the stage: /demo/alderra/refill serves refill.html.
  app.use(
    '/demo/*',
    serveStatic({
      root: DEMO_ROOT,
      rewriteRequestPath: (p) => (/\.[a-z0-9]+$/i.test(p) || p.endsWith('/') ? p.replace(/^\/demo/, '') : `${p.replace(/^\/demo/, '')}.html`),
      onFound: noStore,
    }),
  );

  app.get('/', (c) =>
    c.json({
      name: 'WebAble server',
      routes: ['GET /health', 'GET /v1/stats', 'POST /v1/understand', 'POST /v1/struggle', 'POST /v1/redesign', 'POST /v1/verify-visual', 'POST /v1/overlay-close', 'POST /v1/reader', 'POST /v1/reword/score', 'POST /v1/reword/write', 'POST /v1/compose', 'GET /demo/'],
    }),
  );

  app.notFound((c) => c.json({ error: 'not_found', message: `No route for ${c.req.method} ${c.req.path}` }, 404));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) }, err.status);
    }
    if (err instanceof JevError) return jevErrorResponse(c, err);
    log('internal error', { route: `${c.req.method} ${c.req.path}`, error: errorMessage(err).slice(0, 200) });
    return c.json({ error: 'internal', message: 'Something went wrong on the WebAble server. The page was not changed.' }, 500);
  });

  return app;
}
