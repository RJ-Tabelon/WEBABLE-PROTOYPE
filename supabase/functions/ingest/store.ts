// Storage for opt-in product learning: one call to public.ingest_agg_report,
// a service-role-only function that runs the whole report as one transaction
// (consent check, per-window quota by HMAC tag, aggregate increments, retention).
//
// What is written: a quota row keyed by an HMAC tag (never the user id) and
// increments of (n, ones) per aggregate cell. The user id is used only to read
// the caller's consent inside that transaction.

import type { AggReport } from '../_shared/core.bundle.js';

export type AggCell = AggReport['cells'][number];

export interface IngestSubmission {
  /** Read-only: the consent lookup. Never written anywhere. */
  userId: string;
  /** HMAC tag, 64 hex characters (tag.ts). */
  tag: string;
  /** Quota period: the window id. */
  period: string;
  /** When the quota row may be deleted (window end + grace). */
  expiresAt: Date;
  /** Reports per account per period. */
  limit: number;
  windowId: string;
  libVer: string;
  cells: readonly AggCell[];
  /** Aggregates for windows before this id are past retention and deleted. */
  retentionCutoff: string;
}

export type IngestOutcome = 'stored' | 'no_consent' | 'already_reported';

export interface IngestStore {
  submit(submission: IngestSubmission): Promise<IngestOutcome>;
}

/** The one method this store needs from a Supabase service-role client. */
export interface RpcClient {
  rpc(
    fn: 'ingest_agg_report',
    args: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: { message: string } | null }>;
}

const OUTCOMES: readonly IngestOutcome[] = ['stored', 'no_consent', 'already_reported'];

export function createRpcIngestStore(client: RpcClient): IngestStore {
  return {
    async submit(s) {
      // Only the cell key and the randomized bit leave this function.
      const cells = s.cells.map((c) => ({
        op: c.op,
        need: c.need,
        cat: c.cat,
        mode: c.mode,
        trigger: c.trigger,
        y: c.y,
      }));
      const { data, error } = await client.rpc('ingest_agg_report', {
        p_user: s.userId,
        p_tag: s.tag,
        p_period: s.period,
        p_expires: s.expiresAt.toISOString(),
        p_limit: s.limit,
        p_window: s.windowId,
        p_lib: s.libVer,
        p_cells: cells,
        p_retention_cutoff: s.retentionCutoff,
      });
      if (error) throw new Error('ingest_rpc_failed');
      if (typeof data !== 'string' || !OUTCOMES.includes(data as IngestOutcome)) {
        throw new Error('ingest_rpc_unexpected');
      }
      return data as IngestOutcome;
    },
  };
}
