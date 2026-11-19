/**
 * Page URL -> what WebAble may do there, and the registrable domain (eTLD+1)
 * used as the local site key. The URL itself is never stored or sent; only the
 * eTLD+1 is kept, and only on this device.
 */

/** Multi-label public suffixes that are common enough to matter (subset of the PSL). */
const MULTI_SUFFIXES = new Set([
  // Country second levels
  'co.uk',
  'org.uk',
  'ac.uk',
  'gov.uk',
  'ltd.uk',
  'plc.uk',
  'me.uk',
  'nhs.uk',
  'com.au',
  'net.au',
  'org.au',
  'edu.au',
  'gov.au',
  'co.nz',
  'org.nz',
  'govt.nz',
  'ac.nz',
  'co.jp',
  'ne.jp',
  'or.jp',
  'ac.jp',
  'go.jp',
  'co.kr',
  'or.kr',
  'go.kr',
  'com.br',
  'gov.br',
  'org.br',
  'net.br',
  'com.cn',
  'net.cn',
  'org.cn',
  'gov.cn',
  'com.mx',
  'gob.mx',
  'org.mx',
  'co.in',
  'gov.in',
  'ac.in',
  'org.in',
  'net.in',
  'co.za',
  'gov.za',
  'org.za',
  'com.tr',
  'gov.tr',
  'com.sg',
  'gov.sg',
  'edu.sg',
  'com.hk',
  'gov.hk',
  'com.tw',
  'gov.tw',
  'com.ar',
  'gob.ar',
  'com.co',
  'gov.co',
  'com.pe',
  'co.il',
  'gov.il',
  'ac.il',
  'com.my',
  'gov.my',
  'co.id',
  'go.id',
  'com.ph',
  'gov.ph',
  'com.vn',
  'gov.vn',
  'com.ua',
  'gov.ua',
  'com.pl',
  'co.at',
  'or.at',
  'gv.at',
  'com.es',
  'gob.es',
  'com.pt',
  'gov.pt',
  'com.eg',
  'gov.eg',
  'com.sa',
  'gov.sa',
  'com.ng',
  'gov.ng',
  'co.ke',
  // Private suffixes (hosted sites: each customer is its own site)
  'github.io',
  'gitlab.io',
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'workers.dev',
  'web.app',
  'firebaseapp.com',
  'herokuapp.com',
  'blogspot.com',
  'wordpress.com',
  'azurewebsites.net',
  'appspot.com',
  'cloudfront.net',
  'fly.dev',
  'onrender.com',
  'glitch.me',
  'repl.co',
  'substack.com',
  'medium.com',
  'tumblr.com',
  'wixsite.com',
  'squarespace.com',
  'myshopify.com',
  'notion.site',
  'webflow.io',
  'framer.website',
  'neocities.org',
]);

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

/** Registrable domain for a hostname (eTLD+1), lower case. IPs and single labels stay as they are. */
export function registrableDomain(hostname: string): string {
  const host = hostname.toLowerCase().replace(/\.+$/, '');
  if (host.startsWith('[') || IPV4.test(host) || !host.includes('.'))
    return host;
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const lastTwo = labels.slice(-2).join('.');
  if (MULTI_SUFFIXES.has(lastTwo)) return labels.slice(-3).join('.');
  const lastThree = labels.slice(-3).join('.');
  if (labels.length > 3 && MULTI_SUFFIXES.has(lastThree))
    return labels.slice(-4).join('.');
  return lastTwo;
}

export type PageAccess =
  /** A normal web page WebAble can adapt. */
  | { kind: 'web'; domain: string }
  /** Chrome's own pages, the Web Store, the PDF viewer, other extensions. */
  | { kind: 'restricted' }
  /** No URL visible (the tab was never granted to WebAble). */
  | { kind: 'unknown' };

const STORE_HOSTS = new Set(['chromewebstore.google.com']);

export function classifyUrl(raw: string | undefined | null): PageAccess {
  if (!raw) return { kind: 'unknown' };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { kind: 'restricted' };
  }
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'http:' || url.protocol === 'https:') {
    if (STORE_HOSTS.has(host)) return { kind: 'restricted' };
    if (host === 'chrome.google.com' && url.pathname.startsWith('/webstore'))
      return { kind: 'restricted' };
    // Chrome's PDF viewer is an extension page; content scripts never run inside it.
    if (/\.pdf$/i.test(url.pathname)) return { kind: 'restricted' };
    if (!host) return { kind: 'restricted' };
    return { kind: 'web', domain: registrableDomain(host) };
  }
  if (url.protocol === 'file:') {
    if (/\.pdf$/i.test(url.pathname)) return { kind: 'restricted' };
    return { kind: 'web', domain: 'file' };
  }
  return { kind: 'restricted' };
}

/** How the domain line reads in the popup. */
export function displayDomain(domain: string | null): string | null {
  if (domain === null) return null;
  return domain === 'file' ? 'File on this computer' : domain;
}
