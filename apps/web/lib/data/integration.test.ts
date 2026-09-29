/**
 * Live integration: the real data layer against the real project, through
 * PostgREST and RLS, signed in as the local test user.
 *
 *   node scripts/create-test-user.mjs            (once)
 *   WEBABLE_INTEGRATION=1 pnpm --filter @webable/web exec vitest run lib/data/integration.test.ts
 *
 * Skipped unless WEBABLE_INTEGRATION=1. It writes only the test user's own rows
 * and removes them afterwards.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import {
  type Database,
  defaultFitProfile,
  type DeviceContext,
} from '@webable/core';
import { parse } from 'dotenv';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createClient } from '../supabase/server';
import { advanceOnboarding, getAccount, updateAccount } from './account';
import { getWeeklyActivity, mondayOf } from './activity';
import {
  completeCalibrationSession,
  startCalibrationSession,
} from './calibration';
import { requestExtensionLink } from './extension';
import { getCurrentFit, listFitHistory, saveFit } from './fit';
import { listInstalls, removeInstall } from './installs';
import { exportMyData } from './privacy';
import { getUser } from './session';

vi.mock('../supabase/server', () => ({ createClient: vi.fn() }));

const ROOT = resolve(__dirname, '../../../..');
const readEnv = (path: string) =>
  existsSync(path) ? parse(readFileSync(path)) : {};
const rootEnv = readEnv(resolve(ROOT, '.env'));
const creds = readEnv(resolve(ROOT, 'supabase/tests/.env.test-user'));
const enabled =
  process.env.WEBABLE_INTEGRATION === '1' &&
  Boolean(
    rootEnv.SUPABASE_URL &&
    rootEnv.SUPABASE_ANON_KEY &&
    creds.TEST_USER_EMAIL &&
    creds.TEST_USER_PASSWORD,
  );

type Client = ReturnType<typeof createSupabaseClient<Database>>;

describe.skipIf(!enabled)('data layer against the live project', () => {
  let client: Client;
  let userId: string;
  const installId = crypto.randomUUID();

  const device: DeviceContext = {
    class: 'laptop',
    input: 'trackpad',
    dprBucket: 2,
    viewport: 'L',
    reducedMotion: false,
    colorScheme: 'light',
    moreContrast: false,
    forcedColors: false,
    rootFontPx: 16,
    zoom: 1,
  };

  async function cleanup() {
    for (const table of [
      'fit_profiles',
      'calibration_sessions',
      'weekly_activity',
      'extension_installs',
    ] as const) {
      await client.from(table).delete().eq('user_id', userId);
    }
    await client
      .from('accounts')
      .update({
        onboarding_step: 'new',
        cloud_analysis: false,
        product_learning: false,
        theme: 'system',
      })
      .eq('user_id', userId);
  }

  beforeAll(async () => {
    client = createSupabaseClient<Database>(
      rootEnv.SUPABASE_URL as string,
      rootEnv.SUPABASE_ANON_KEY as string,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );
    const { data, error } = await client.auth.signInWithPassword({
      email: creds.TEST_USER_EMAIL as string,
      password: creds.TEST_USER_PASSWORD as string,
    });
    if (error || !data.user)
      throw new Error(`test user sign-in failed: ${error?.code ?? 'no user'}`);
    userId = data.user.id;
    vi.mocked(createClient).mockResolvedValue(
      client as unknown as Awaited<ReturnType<typeof createClient>>,
    );
    await cleanup();
  });

  afterAll(async () => {
    if (!client) return;
    await cleanup();
    await client.auth.signOut({ scope: 'local' });
  });

  it('verifies the session', async () => {
    expect(await getUser()).toEqual({
      id: userId,
      email: creds.TEST_USER_EMAIL,
    });
  });

  it('reads and updates the account', async () => {
    const account = await getAccount();
    expect(account).toMatchObject({
      ok: true,
      data: { onboardingStep: 'new', cloudAnalysis: false },
    });
    const updated = await updateAccount({ cloudAnalysis: true, theme: 'dark' });
    expect(updated).toMatchObject({
      ok: true,
      data: { cloudAnalysis: true, theme: 'dark' },
    });
  });

  it('runs a Tune session and saves versioned fits', async () => {
    const started = await startCalibrationSession({ device });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect((await getAccount()).ok && (await getAccount())).toMatchObject({
      data: { onboardingStep: 'tuning' },
    });

    const completed = await completeCalibrationSession({
      id: started.data.id,
      modules: {},
    });
    expect(completed).toMatchObject({
      ok: true,
      data: { id: started.data.id },
    });
    const again = await completeCalibrationSession({
      id: started.data.id,
      modules: {},
    });
    expect(again).toMatchObject({ ok: false, error: { code: 'not_found' } });

    const profile = defaultFitProfile();
    const v1 = await saveFit({
      profile,
      source: 'calibration',
      calibrationSessionId: started.data.id,
    });
    const v2 = await saveFit({ profile, source: 'adjustment' });
    expect([v1.ok && v1.data.version, v2.ok && v2.data.version]).toEqual([
      1, 2,
    ]);

    const current = await getCurrentFit();
    expect(current).toMatchObject({
      ok: true,
      data: { version: 2, isCurrent: true, source: 'adjustment' },
    });
    const history = await listFitHistory();
    expect(
      history.ok && history.data.map((h) => [h.version, h.isCurrent]),
    ).toEqual([
      [2, true],
      [1, false],
    ]);
    expect(await advanceOnboarding('tuning')).toEqual({
      ok: true,
      data: { onboardingStep: 'tuned' },
    });
  });

  it('reads weekly activity and installs', async () => {
    const week = mondayOf(new Date());
    const { error } = await client.rpc('record_activity', {
      p_week: week,
      p_counts: { text_size: { applied: 2, kept: 1 } },
    });
    expect(error).toBeNull();
    const activity = await getWeeklyActivity({ weeks: 2 });
    expect(activity.ok && activity.data.totals.applied).toBe(2);

    await client.from('extension_installs').insert({
      id: installId,
      user_id: userId,
      browser: 'chrome',
      platform: 'mac',
      extension_version: '0.1.0',
    });
    const installs = await listInstalls();
    expect(installs.ok && installs.data.map((i) => i.id)).toEqual([installId]);
    expect(await removeInstall({ id: installId })).toEqual({
      ok: true,
      data: { id: installId },
    });
    expect(await removeInstall({ id: installId })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('exports only this person', async () => {
    const exported = await exportMyData();
    expect(exported.ok).toBe(true);
    if (!exported.ok) return;
    const doc = exported.data.document as {
      account: { user_id: string };
      fit_profiles: { user_id: string }[];
    };
    expect(doc.account.user_id).toBe(userId);
    expect(doc.fit_profiles.every((f) => f.user_id === userId)).toBe(true);
  });

  it('calls extension-link (answers with a typed error until the function is deployed)', async () => {
    const link = await requestExtensionLink();
    if (link.ok) {
      expect(link.data.email).toBe(creds.TEST_USER_EMAIL);
      expect(link.data.tokenHash.length).toBeGreaterThanOrEqual(16);
    } else {
      expect(['unavailable', 'unknown']).toContain(link.error.code);
    }
  });
});
