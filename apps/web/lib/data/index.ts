/**
 * Data access for the web app. It runs in the browser: each function reads the
 * session from this site's cookies, talks to Supabase directly (row level
 * security limits it to the person's own rows), validates its input, and
 * resolves to a DataResult: { ok: true, data } | { ok: false, error: { code, message } }.
 */

export * from './result';
export * from './session';
export * from './account';
export * from './fit';
export * from './calibration';
export * from './activity';
export * from './installs';
export * from './privacy';
export * from './extension';
