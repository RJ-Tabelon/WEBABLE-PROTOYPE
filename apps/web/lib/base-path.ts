/**
 * The path the site is served under: '' locally, '/WEBABLE-PROTOYPE' on GitHub
 * Pages (NEXT_PUBLIC_BASE_PATH, inlined at build). next/link and the router add
 * it on their own; plain URLs (images, icons, the manifest, full-page
 * navigations, email links) go through withBase().
 */
export const BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH ?? '').replace(
  /\/+$/,
  '',
);

/** "/hero/a.webp" -> "/WEBABLE-PROTOYPE/hero/a.webp" on Pages. */
export function withBase(path: string): string {
  return path.startsWith('/') && !path.startsWith('//')
    ? `${BASE_PATH}${path}`
    : path;
}

/** location.pathname without the base path, for checks written against "/app" etc. */
export function stripBase(pathname: string): string {
  if (
    BASE_PATH &&
    (pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`))
  )
    return pathname.slice(BASE_PATH.length) || '/';
  return pathname;
}
