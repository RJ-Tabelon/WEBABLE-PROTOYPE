import {
  CALIBRATION_VERSION,
  defaultFitProfile,
  type DeviceContext,
} from '@webable/core';
import { FunctionsFetchError, FunctionsHttpError } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createClient } from '../supabase/server';
import { createFakeSupabase, type FakeSupabase } from '../supabase/testing';
import { advanceOnboarding, getAccount, updateAccount } from './account';
import { getWeeklyActivity, mondayOf, recentMondays } from './activity';
import {
  abandonCalibrationSession,
  completeCalibrationSession,
  startCalibrationSession,
} from './calibration';
import { requestExtensionLink } from './extension';
import { getCurrentFit, listFitHistory, saveFit } from './fit';
import { listInstalls, removeInstall } from './installs';
import { deleteMyAccount, exportMyData } from './privacy';
import { getSession, getUser } from './session';

vi.mock('../supabase/server', () => ({ createClient: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
let fake: FakeSupabase;

function use(f: FakeSupabase) {
  fake = f;
  vi.mocked(createClient).mockResolvedValue(
    f.client as unknown as Awaited<ReturnType<typeof createClient>>,
  );
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  use(createFakeSupabase(USER));
});

const accountRow = {
  onboarding_step: 'new',
  cloud_analysis: false,
  ai_layout: false,
  product_learning: false,
  theme: 'system',
  created_at: '2026-09-29T10:00:00Z',
  updated_at: '2026-09-29T10:00:00Z',
};

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

describe('session', () => {
  it('returns the verified user and expiry, never tokens', async () => {
    expect(await getUser()).toEqual({ id: USER, email: 'person@example.com' });
    expect(await getSession()).toEqual({
      user: { id: USER, email: 'person@example.com' },
      expiresAt: 2_000_000_000,
    });
  });

  it('is null when signed out or when verification fails', async () => {
    use(createFakeSupabase(null));
    expect(await getUser()).toBeNull();
    use(
      createFakeSupabase(USER).onAuth('getClaims', async () => ({
        data: null,
        error: { name: 'AuthInvalidJwtError' },
      })),
    );
    expect(await getSession()).toBeNull();
    use(
      createFakeSupabase(USER).onAuth('getClaims', async () =>
        Promise.reject(new Error('jwks')),
      ),
    );
    expect(await getUser()).toBeNull();
  });
});

describe('every data function requires a session', () => {
  it.each([
    ['getAccount', () => getAccount()],
    ['updateAccount', () => updateAccount({ theme: 'dark' })],
    ['getCurrentFit', () => getCurrentFit()],
    ['listFitHistory', () => listFitHistory()],
    [
      'saveFit',
      () => saveFit({ profile: defaultFitProfile(), source: 'calibration' }),
    ],
    ['startCalibrationSession', () => startCalibrationSession({ device })],
    ['getWeeklyActivity', () => getWeeklyActivity()],
    ['listInstalls', () => listInstalls()],
    ['exportMyData', () => exportMyData()],
    ['deleteMyAccount', () => deleteMyAccount()],
    ['requestExtensionLink', () => requestExtensionLink()],
  ])('%s', async (_name, call) => {
    use(createFakeSupabase(null));
    const result = await call();
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'not_signed_in' },
    });
    expect(fake.queries).toEqual([]);
    expect(fake.rpcCalls).toEqual([]);
  });
});

describe('account', () => {
  it('reads the own account in camelCase', async () => {
    fake.queue('accounts', { data: accountRow });
    const result = await getAccount();
    expect(result).toEqual({
      ok: true,
      data: {
        onboardingStep: 'new',
        cloudAnalysis: false,
        aiLayout: false,
        productLearning: false,
        theme: 'system',
        createdAt: accountRow.created_at,
        updatedAt: accountRow.updated_at,
      },
    });
    expect(fake.queries[0]?.ops).toContainEqual(['eq', 'user_id', USER]);
  });

  it('updates only the given consent fields', async () => {
    fake.queue('accounts', { data: { ...accountRow, cloud_analysis: true } });
    const result = await updateAccount({ cloudAnalysis: true });
    expect(result.ok && result.data.cloudAnalysis).toBe(true);
    expect(fake.queries[0]?.ops[0]).toEqual([
      'update',
      { cloud_analysis: true },
    ]);
  });

  it('reads and saves the layout planning consent on its own (accounts.ai_layout)', async () => {
    fake.queue('accounts', { data: { ...accountRow, ai_layout: true } });
    const result = await updateAccount({ aiLayout: true });
    expect(result.ok && result.data.aiLayout).toBe(true);
    expect(result.ok && result.data.cloudAnalysis).toBe(false);
    expect(fake.queries[0]?.ops[0]).toEqual(['update', { ai_layout: true }]);
    expect(fake.queries[0]?.ops).toContainEqual([
      'select',
      expect.stringContaining('ai_layout'),
    ]);
  });

  it('rejects empty, unknown or malformed patches before any query', async () => {
    expect((await updateAccount({})).ok).toBe(false);
    expect((await updateAccount({ theme: 'blue' as 'dark' })).ok).toBe(false);
    expect(
      (await updateAccount({ aiLayout: 'yes' as unknown as boolean })).ok,
    ).toBe(false);
    expect(
      (await updateAccount({ onboardingStep: 'connected' } as never)).ok,
    ).toBe(false);
    expect(fake.queries).toEqual([]);
  });

  it('advances onboarding only forward', async () => {
    fake
      .queue('accounts', { data: null })
      .queue('accounts', { data: { onboarding_step: 'tuned' } });
    const result = await advanceOnboarding('tuning');
    expect(result).toEqual({ ok: true, data: { onboardingStep: 'tuned' } });
    expect(fake.queries[0]?.ops).toContainEqual([
      'in',
      'onboarding_step',
      ['new'],
    ]);
    expect(fake.queries[0]?.ops[0]).toEqual([
      'update',
      { onboarding_step: 'tuning' },
    ]);
  });

  it('maps database errors to stable codes', async () => {
    fake.queue('accounts', {
      error: { code: '', message: 'TypeError: fetch failed' },
    });
    expect(await getAccount()).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
  });
});

describe('fit', () => {
  const profile = defaultFitProfile(
    undefined,
    new Date('2026-09-29T10:00:00Z'),
  );
  const row = {
    id: '33333333-3333-4333-8333-333333333333',
    version: 2,
    profile,
    source: 'calibration',
    derivation_version: profile.derivationVersion,
    calibration_session_id: SESSION,
    is_current: true,
    created_at: '2026-09-29T10:00:00Z',
  };

  it('parses the current fit', async () => {
    fake.queue('fit_profiles', { data: row });
    const result = await getCurrentFit();
    expect(result.ok && result.data?.version).toBe(2);
    expect(result.ok && result.data?.profile.vision.textMinPx.value).toBe(16);
    expect(fake.queries[0]?.ops).toContainEqual(['eq', 'is_current', true]);
  });

  it('is null before the first Tune', async () => {
    fake.queue('fit_profiles', { data: null });
    expect(await getCurrentFit()).toEqual({ ok: true, data: null });
  });

  it('reports a stored fit that no longer parses', async () => {
    fake.queue('fit_profiles', { data: { ...row, profile: { v: 1 } } });
    expect(await getCurrentFit()).toMatchObject({
      ok: false,
      error: { code: 'invalid_data' },
    });
  });

  it('lists history newest first and tolerates old shapes', async () => {
    fake.queue('fit_profiles', {
      data: [row, { ...row, version: 1, is_current: false, profile: { v: 1 } }],
    });
    const result = await listFitHistory({ limit: 5 });
    expect(
      result.ok && result.data.map((e) => [e.version, e.profile === null]),
    ).toEqual([
      [2, false],
      [1, true],
    ]);
    expect(fake.queries[0]?.ops).toContainEqual([
      'order',
      'version',
      { ascending: false },
    ]);
    expect(fake.queries[0]?.ops).toContainEqual(['limit', 5]);
    expect((await listFitHistory({ limit: 500 })).ok).toBe(false);
  });

  it('saves through save_fit_profile with the validated profile', async () => {
    fake.rpcResult('save_fit_profile', { data: row });
    const result = await saveFit({
      profile,
      source: 'calibration',
      calibrationSessionId: SESSION,
    });
    expect(result.ok && result.data.version).toBe(2);
    expect(fake.rpcCalls).toEqual([
      {
        fn: 'save_fit_profile',
        args: {
          p_profile: profile,
          p_source: 'calibration',
          p_derivation_version: profile.derivationVersion,
          p_calibration_session_id: SESSION,
        },
      },
    ]);
  });

  it('refuses invalid or oversized profiles before calling the database', async () => {
    const bad = await saveFit({
      profile: { ...profile, v: 2 } as never,
      source: 'calibration',
    });
    expect(bad).toMatchObject({ ok: false, error: { code: 'invalid_input' } });
    expect(!bad.ok && bad.error.issues).toContain('profile.v');
    expect((await saveFit({ profile, source: 'guess' as 'import' })).ok).toBe(
      false,
    );
    const big = await saveFit({
      profile: { ...profile, derivationVersion: 'x'.repeat(33) },
      source: 'calibration',
    });
    expect(big.ok).toBe(false);
    expect(fake.rpcCalls).toEqual([]);
  });

  it('maps a database rejection', async () => {
    fake.rpcResult('save_fit_profile', {
      error: { code: '23514', message: 'violates check' },
    });
    expect(await saveFit({ profile, source: 'adjustment' })).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
  });
});

describe('calibration', () => {
  it('starts a session with the current battery version and moves onboarding', async () => {
    fake
      .queue('calibration_sessions', {
        data: {
          id: SESSION,
          calibration_version: CALIBRATION_VERSION,
          started_at: '2026-09-29T10:00:00Z',
        },
      })
      .queue('accounts', { data: null })
      .queue('accounts', { data: { onboarding_step: 'tuning' } });
    const result = await startCalibrationSession({ device });
    expect(result).toEqual({
      ok: true,
      data: {
        id: SESSION,
        calibrationVersion: CALIBRATION_VERSION,
        startedAt: '2026-09-29T10:00:00Z',
      },
    });
    expect(fake.queries[0]?.ops[0]).toEqual([
      'insert',
      { user_id: USER, calibration_version: CALIBRATION_VERSION, device },
    ]);
    expect(fake.queries.map((q) => q.table)).toEqual([
      'calibration_sessions',
      'accounts',
      'accounts',
    ]);
  });

  it('rejects device data outside the coarse buckets', async () => {
    const result = await startCalibrationSession({
      device: { ...device, zoom: 50 },
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(!result.ok && result.error.issues).toContain('device.zoom');
    fake.queue('calibration_sessions', {
      data: {
        id: SESSION,
        calibration_version: CALIBRATION_VERSION,
        started_at: '2026-09-29T10:00:00Z',
      },
    });
    expect(
      (
        await startCalibrationSession({
          device: { ...device, screenWidth: 1512 },
        } as never)
      ).ok,
      'no extra fields such as screen fingerprints',
    ).toBe(true);
    expect(fake.queries[0]?.ops[0]?.[1]).not.toHaveProperty(
      'device.screenWidth',
    );
  });

  it('completes only an in-progress session of the caller', async () => {
    fake.queue('calibration_sessions', {
      data: {
        id: SESSION,
        calibration_version: CALIBRATION_VERSION,
        started_at: '2026-09-29T10:00:00Z',
        completed_at: '2026-09-29T10:06:00Z',
      },
    });
    const result = await completeCalibrationSession({
      id: SESSION,
      modules: {},
    });
    expect(result.ok && result.data.completedAt).toBe('2026-09-29T10:06:00Z');
    const ops = fake.queries[0]?.ops ?? [];
    expect(ops[0]?.[0]).toBe('update');
    expect(ops[0]?.[1]).toMatchObject({ status: 'completed', modules: {} });
    expect(ops).toContainEqual(['eq', 'id', SESSION]);
    expect(ops).toContainEqual(['eq', 'user_id', USER]);
    expect(ops).toContainEqual(['eq', 'status', 'in_progress']);
  });

  it('reports a session that is already finished', async () => {
    fake.queue('calibration_sessions', { data: null });
    expect(
      await completeCalibrationSession({ id: SESSION, modules: {} }),
    ).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
  });

  it('validates module summaries with the shared schema', async () => {
    const result = await completeCalibrationSession({
      id: SESSION,
      modules: { reading: { status: 'measured' } } as never,
    });
    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_input' },
    });
    expect(
      (await completeCalibrationSession({ id: 'not-a-uuid', modules: {} })).ok,
    ).toBe(false);
    expect(fake.queries).toEqual([]);
  });

  it('abandons idempotently', async () => {
    expect(await abandonCalibrationSession({ id: SESSION })).toEqual({
      ok: true,
      data: { id: SESSION },
    });
    expect(fake.queries[0]?.ops[0]).toEqual([
      'update',
      { status: 'abandoned' },
    ]);
  });
});

describe('activity', () => {
  it('computes ISO Mondays in UTC', () => {
    expect(mondayOf(new Date('2026-09-29T10:00:00Z'))).toBe('2026-09-28'); // Tuesday
    expect(mondayOf(new Date('2026-09-28T00:00:00Z'))).toBe('2026-09-28'); // Monday
    expect(mondayOf(new Date('2026-10-04T23:59:59Z'))).toBe('2026-09-28'); // Sunday
    expect(recentMondays(3, new Date('2026-09-29T10:00:00Z'))).toEqual([
      '2026-09-14',
      '2026-09-21',
      '2026-09-28',
    ]);
  });

  it('returns rows, the full week range and totals', async () => {
    fake.queue('weekly_activity', {
      data: [
        {
          week: '2026-09-21',
          op: 'text_size',
          applied: 3,
          kept: 2,
          undone: 1,
          undone_by_checks: 0,
          offered: 1,
          accepted: 1,
        },
        {
          week: '2026-09-28',
          op: 'target_size',
          applied: 1,
          kept: 1,
          undone: 0,
          undone_by_checks: 1,
          offered: 0,
          accepted: 0,
        },
      ],
    });
    const result = await getWeeklyActivity(
      { weeks: 2 },
      new Date('2026-09-29T10:00:00Z'),
    );
    expect(result.ok && result.data.weeks).toEqual([
      '2026-09-21',
      '2026-09-28',
    ]);
    expect(result.ok && result.data.totals).toEqual({
      applied: 4,
      kept: 3,
      undone: 1,
      undoneByChecks: 1,
      offered: 1,
      accepted: 1,
    });
    expect(result.ok && result.data.rows[0]).toMatchObject({
      week: '2026-09-21',
      op: 'text_size',
      undoneByChecks: 0,
    });
    expect(fake.queries[0]?.ops).toContainEqual(['gte', 'week', '2026-09-21']);
  });

  it('bounds the range to 26 weeks', async () => {
    expect((await getWeeklyActivity({ weeks: 27 })).ok).toBe(false);
    expect((await getWeeklyActivity({ weeks: 0 })).ok).toBe(false);
  });
});

describe('installs', () => {
  it('lists connected browsers', async () => {
    fake.queue('extension_installs', {
      data: [
        {
          id: SESSION,
          browser: 'chrome',
          platform: 'mac',
          extension_version: '0.1.0',
          connected_at: '2026-09-29T10:00:00Z',
          last_seen_at: '2026-09-29T11:00:00Z',
        },
      ],
    });
    const result = await listInstalls();
    expect(result.ok && result.data[0]).toEqual({
      id: SESSION,
      browser: 'chrome',
      platform: 'mac',
      extensionVersion: '0.1.0',
      connectedAt: '2026-09-29T10:00:00Z',
      lastSeenAt: '2026-09-29T11:00:00Z',
    });
  });

  it('removes one install of the caller, or reports it missing', async () => {
    fake
      .queue('extension_installs', { data: [{ id: SESSION }] })
      .queue('extension_installs', { data: [] });
    expect(await removeInstall({ id: SESSION })).toEqual({
      ok: true,
      data: { id: SESSION },
    });
    expect(fake.queries[0]?.ops).toContainEqual(['eq', 'user_id', USER]);
    expect(await removeInstall({ id: SESSION })).toMatchObject({
      ok: false,
      error: { code: 'not_found' },
    });
    expect((await removeInstall({ id: 'x' })).ok).toBe(false);
  });
});

describe('privacy', () => {
  it('exports the own document with a dated filename', async () => {
    const document = { account: { user_id: USER }, fit_profiles: [] };
    fake.rpcResult('export_my_data', { data: document });
    const result = await exportMyData(new Date('2026-09-29T10:00:00Z'));
    expect(result).toEqual({
      ok: true,
      data: { document, filename: 'webable-data-2026-09-29.json' },
    });
  });

  it('deletes the account and clears the local session', async () => {
    expect(await deleteMyAccount()).toEqual({
      ok: true,
      data: { deleted: true },
    });
    expect(fake.rpcCalls.map((c) => c.fn)).toEqual(['delete_my_account']);
    expect(fake.authCalls.map(([m]) => m)).toEqual(['getClaims', 'signOut']);
    expect(fake.authCalls[1]).toEqual(['signOut', [{ scope: 'local' }]]);
  });

  it('keeps the session when deletion fails', async () => {
    fake.rpcResult('delete_my_account', {
      error: { code: '57014', message: 'timeout' },
    });
    expect(await deleteMyAccount()).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
    expect(fake.authCalls.map(([m]) => m)).toEqual(['getClaims']);
  });
});

describe('requestExtensionLink', () => {
  const httpError = (status: number) =>
    new FunctionsHttpError(new Response('{}', { status }));

  it('returns the token hash for the signed-in person', async () => {
    fake.onInvoke(async () => ({
      data: { tokenHash: 'h'.repeat(56), email: 'Person@example.com' },
      error: null,
    }));
    const result = await requestExtensionLink();
    expect(result).toEqual({
      ok: true,
      data: { tokenHash: 'h'.repeat(56), email: 'Person@example.com' },
    });
    expect(fake.authCalls.at(-1)).toEqual([
      'functions.invoke',
      ['extension-link', { method: 'POST', body: {} }],
    ]);
  });

  it('refuses a link for someone else or a malformed answer', async () => {
    fake.onInvoke(async () => ({
      data: { tokenHash: 'h'.repeat(56), email: 'other@example.com' },
      error: null,
    }));
    expect((await requestExtensionLink()).ok).toBe(false);
    fake.onInvoke(async () => ({
      data: { tokenHash: 'short', email: 'person@example.com' },
      error: null,
    }));
    expect((await requestExtensionLink()).ok).toBe(false);
  });

  it.each([
    [401, 'not_signed_in'],
    [429, 'rate_limited'],
    [403, 'invalid_input'],
    [503, 'unavailable'],
  ])('maps HTTP %i to %s', async (status, code) => {
    fake.onInvoke(async () => ({ data: null, error: httpError(status) }));
    expect(await requestExtensionLink()).toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it('maps a network failure to unavailable', async () => {
    fake.onInvoke(async () => ({
      data: null,
      error: new FunctionsFetchError(new TypeError('fetch failed')),
    }));
    expect(await requestExtensionLink()).toMatchObject({
      ok: false,
      error: { code: 'unavailable' },
    });
  });
});
