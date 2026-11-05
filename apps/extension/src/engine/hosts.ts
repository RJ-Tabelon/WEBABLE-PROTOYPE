// Sites WebAble never sends page text from: webmail, chat, banking and patient portals
// (research-engineering.md §14 policy gates). The paragraph rewrites and the built WebAble page both check this.

const EXCLUDED_HOSTS: RegExp[] = [
  /^mail\.google\.com$/, /(^|\.)outlook\.(live|office|office365)\.com$/, /^mail\.yahoo\.com$/, /^mail\.proton\.me$/,
  /^(www\.)?icloud\.com$/, /^mail\.aol\.com$/, /^web\.whatsapp\.com$/, /(^|\.)messenger\.com$/, /^app\.slack\.com$/,
  /^(www\.)?discord\.com$/, /^web\.telegram\.org$/, /^teams\.(microsoft|live)\.com$/, /^messages\.google\.com$/,
  /(^|\.)chase\.com$/, /(^|\.)bankofamerica\.com$/, /(^|\.)wellsfargo\.com$/, /(^|\.)citi\.com$/,
  /(^|\.)capitalone\.com$/, /(^|\.)usbank\.com$/, /(^|\.)pnc\.com$/, /(^|\.)tdbank\.com$/, /(^|\.)ally\.com$/,
  /(^|\.)americanexpress\.com$/, /(^|\.)discover\.com$/, /(^|\.)schwab\.com$/, /(^|\.)fidelity\.com$/,
  /(^|\.)vanguard\.com$/, /(^|\.)paypal\.com$/, /(^|\.)venmo\.com$/, /(^|\.)bank$/, /(^|\.)mychart\./,
];

export function isExcludedHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return EXCLUDED_HOSTS.some((re) => re.test(h));
}
