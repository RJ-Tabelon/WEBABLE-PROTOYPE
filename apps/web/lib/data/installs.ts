import { z } from 'zod';

import {
  type DataResult,
  fail,
  guarded,
  issuePaths,
  mapPostgrestError,
  ok,
} from './result';
import { getDataContext } from './session';

/** A connected browser. The id is random per install; no device identifiers are stored. */
export interface ExtensionInstall {
  id: string;
  browser: string;
  platform: string;
  extensionVersion: string;
  connectedAt: string;
  lastSeenAt: string;
}

/** Connected browsers, most recently seen first. */
export async function listInstalls(): Promise<DataResult<ExtensionInstall[]>> {
  return guarded('listInstalls', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const { data, error } = await supabase
      .from('extension_installs')
      .select(
        'id, browser, platform, extension_version, connected_at, last_seen_at',
      )
      .eq('user_id', user.id)
      .order('last_seen_at', { ascending: false });
    if (error) return fail(mapPostgrestError(error));

    return ok(
      data.map((row) => ({
        id: row.id,
        browser: row.browser,
        platform: row.platform,
        extensionVersion: row.extension_version,
        connectedAt: row.connected_at,
        lastSeenAt: row.last_seen_at,
      })),
    );
  });
}

export const removeInstallInputSchema = z.strictObject({ id: z.uuid() });

/**
 * Forget a connected browser. That extension keeps its own session until it
 * signs out or the person signs out everywhere; it re-registers if it connects again.
 */
export async function removeInstall(
  input: z.input<typeof removeInstallInputSchema>,
): Promise<DataResult<{ id: string }>> {
  const parsed = removeInstallInputSchema.safeParse(input);
  if (!parsed.success)
    return fail('invalid_input', issuePaths(parsed.error.issues));

  return guarded('removeInstall', async () => {
    const ctx = await getDataContext();
    if (!ctx.ok) return ctx;
    const { supabase, user } = ctx.data;

    const { data, error } = await supabase
      .from('extension_installs')
      .delete()
      .eq('id', parsed.data.id)
      .eq('user_id', user.id)
      .select('id');
    if (error) return fail(mapPostgrestError(error));
    if (data.length === 0) return fail('not_found');
    return ok({ id: parsed.data.id });
  });
}
