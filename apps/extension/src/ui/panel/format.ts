// Owner: D2. Number formatting and Jev totals (the Jev view uses these; the sheet never shows them).
import type { JevMetrics, Role } from '@webable/core';
import type { EngineState } from '../../contracts';

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Probability as two decimals, the way Jev quantises it ('0.97'). */
export function fmtP(p: number | null | undefined): string {
  if (p == null || !Number.isFinite(p)) return '–';
  return clamp(p, 0, 1).toFixed(2);
}

export function fmtCount(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** '$0.00047', '$0.0018', '$0.013'. Small amounts keep two significant digits. */
export function fmtCost(usd: number): string {
  if (!Number.isFinite(usd) || usd <= 0) return '$0';
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd >= 0.01) return `$${usd.toFixed(3)}`;
  const digits = Math.min(7, Math.max(4, 1 - Math.floor(Math.log10(usd))));
  // Two significant digits, trailing zeros dropped: $0.00047, $0.0018, $0.00009.
  return `$${usd.toFixed(digits).replace(/(\.\d*?[1-9])0+$/, '$1')}`;
}

/** '182 ms' below a second, '1.37 s' above. */
export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

/** Always seconds, for the counter: '0.31 s'. */
export function fmtSeconds(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return '–';
  return `${(ms / 1000).toFixed(2)} s`;
}

export function fmtTokens(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k tokens`;
  return `${Math.round(n)} tokens`;
}

/** '+1.4 s' since the engine booted. */
export function fmtSince(atMs: number): string {
  if (!Number.isFinite(atMs)) return '';
  if (atMs < 60_000) return `+${(Math.max(0, atMs) / 1000).toFixed(1)} s`;
  const m = Math.floor(atMs / 60_000);
  const s = Math.round((atMs % 60_000) / 1000);
  return `+${m} min ${s} s`;
}

export const ROLE_LABEL: Record<Role, string> = {
  main_content: 'content',
  form_field: 'field',
  action_button: 'button',
  navigation: 'navigation',
  search: 'search',
  advertising: 'advertising',
  recommendations: 'recommended',
  popup_overlay: 'popup',
  consent_notice: 'consent',
  help_contact: 'help',
  account_utility: 'account',
  legal_footer: 'legal',
  other: 'other',
};

export function roleLabel(role: Role | string | null | undefined): string {
  if (!role) return 'other';
  return (ROLE_LABEL as Record<string, string>)[role] ?? String(role).replace(/_/g, ' ');
}

/**
 * One set of Jev numbers for the whole chrome, so the Lens header and the panel always agree.
 *
 * The headline is the page read: Jev's understanding of this page (one set of parallel calls). When that read was
 * replayed from the server's cache, the headline numbers are those of the first live read (`firstRead`) and
 * `viewUsd` is $0. `sinceLoad` adds every other Jev call this page made (struggle checks, layout judge, visual
 * check), with cached answers counted as decisions but never as cost.
 */
export interface JevTotals {
  /** Typed answers in the page read (one per question). */
  decisions: number;
  /** Calls in the page read, all sent in parallel. */
  calls: number;
  /** What the page read cost when Jev answered it live (the first read's cost when this view came from cache). */
  costUsd: number;
  inputTokens: number;
  /** Wall time of the page read as the extension saw it (the first read's when cached). */
  headlineMs: number | null;
  /** Jev's own server time for the page read (from x-envoy-upstream-service-time). */
  serverMs: number | null;
  model: string;
  /** The page read came from the server's cache. */
  cached: boolean;
  /** When cached: the metrics of the first live read of this page (null if the server did not send them). */
  firstRead: JevMetrics | null;
  /** What this view spent on the page read: $0 when it came from cache. */
  viewUsd: number;
  /** Wall time of this view's cached read, when the server reported it separately from the first read. */
  viewMs: number | null;
  /** Every Jev call since this page loaded, the page read included. */
  sinceLoad: { decisions: number; calls: number; costUsd: number; inputTokens: number };
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Every Jev metrics object the engine holds for this page, deduplicated by identity. */
export function jevMetricsList(s: EngineState): JevMetrics[] {
  const seen = new Set<JevMetrics>();
  const add = (m: JevMetrics | null | undefined) => {
    if (m && typeof m === 'object') seen.add(m);
  };
  add(s.understanding?.metrics);
  for (const j of s.struggle.history) add(j?.metrics);
  add(s.struggle.latest?.metrics);
  add(s.calm.redesign?.judge);
  add(s.calm.visual?.metrics);
  return [...seen];
}

export function jevTotals(s: EngineState): JevTotals {
  const u = s.understanding;
  const cached = Boolean(u?.cached);
  const own = u?.metrics ?? null;
  // A cached view reports the first live read as its headline; this view's own read cost nothing.
  const fr = cached && u?.firstRead && typeof u.firstRead === 'object' ? u.firstRead : null;
  const head = fr ?? own;
  const sinceLoad = { decisions: 0, calls: 0, costUsd: 0, inputTokens: 0 };
  for (const m of jevMetricsList(s)) {
    // A cached page read reports 0 calls and $0 for itself (plus any live reads of items that appeared later).
    sinceLoad.decisions += num(m.questions);
    sinceLoad.calls += num(m.calls);
    sinceLoad.costUsd += num(m.costUsd);
    sinceLoad.inputTokens += num(m.inputTokens);
  }
  return {
    decisions: num(own?.questions) || num(head?.questions),
    calls: num(head?.calls),
    costUsd: num(head?.costUsd),
    inputTokens: num(head?.inputTokens),
    headlineMs: head ? num(head.wallMs) : null,
    serverMs: head && typeof head.serverMs === 'number' && Number.isFinite(head.serverMs) ? head.serverMs : null,
    model: head?.model || own?.model || 'jev-1.14.0',
    cached,
    firstRead: fr,
    viewUsd: num(own?.costUsd),
    viewMs: fr && own ? num(own.wallMs) : null,
    sinceLoad,
  };
}

/** "187 decisions · 619 ms": the page read, the same words in the Lens header and the panel. */
export function fmtPageRead(t: JevTotals): string {
  return `${fmtCount(t.decisions)} decisions · ${fmtMs(t.headlineMs)}`;
}

/** "from cache · first read 619 ms, $0.0034 · this view $0", or null for a live read. */
export function fmtCacheNote(t: JevTotals): string | null {
  if (!t.cached) return null;
  const first = t.firstRead || t.headlineMs != null ? `first read ${fmtMs(t.headlineMs)}, ${fmtCost(t.costUsd)}` : 'first read earlier';
  return `from cache · ${first} · this view ${fmtCost(t.viewUsd)}`;
}

/** "227 since load" when this page made more Jev calls than the page read, else null. */
export function fmtSinceLoad(t: JevTotals): string | null {
  if (t.sinceLoad.decisions <= t.decisions) return null;
  return `${fmtCount(t.sinceLoad.decisions)} since load`;
}

export function pageOrigin(): string {
  try {
    return location.origin;
  } catch {
    return '';
  }
}
