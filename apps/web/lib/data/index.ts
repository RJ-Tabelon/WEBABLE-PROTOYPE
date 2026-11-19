/**
 * Server-side data access for the web app. Import from Server Components,
 * Route Handlers and Server Actions only (it reads request cookies). Client
 * Components use the Server Actions in ./actions.
 *
 * Every function verifies the session, validates its input, and resolves to a
 * DataResult: { ok: true, data } | { ok: false, error: { code, message } }.
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
