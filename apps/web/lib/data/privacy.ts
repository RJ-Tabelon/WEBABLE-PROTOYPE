import type { Json } from '@webable/core';

import {
  type DataResult,
  fail,
  guarded,
  mapPostgrestError,
  ok,
} from './result';
import { getDataContext } from './session';

export interface DataExport {
  /** Everything WebAble stores about the person, as returned by export_my_data(). */
  document: Json;
  /** Suggested download name, e.g. "webable-data-2026-09-29.json". */
  filename: string;
}

/** Everything the server holds about the signed-in person, as one JSON document. */
export async function exportMyData(
  now: Date = new Date(),
): Promise<DataResult<DataExport>> {
  return guarded('exportMyData', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;

    const { data, error } = await ctx.data.supabase.rpc('export_my_data');
    if (error) return fail(mapPostgrestError(error));
    if (data === null || typeof data !== 'object') return fail('unknown');
    return ok({
      document: data,
      filename: `webable-data-${now.toISOString().slice(0, 10)}.json`,
    });
  });
}

/**
 * Permanently delete the account and, by cascade, every row tied to it; then
 * clear this browser's session. The UI must ask for explicit confirmation first,
 * because this cannot be undone. Data kept only in the extension is cleared there.
 */
export async function deleteMyAccount(): Promise<
  DataResult<{ deleted: true }>
> {
  return guarded('deleteMyAccount', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase } = ctx.data;

    const { error } = await supabase.rpc('delete_my_account');
    if (error) return fail(mapPostgrestError(error));

    // The sessions went with the user; this clears the now-invalid cookies.
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    return ok({ deleted: true });
  });
}
