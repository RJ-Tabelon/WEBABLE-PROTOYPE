import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isExcludedSite } from '@webable/core/page/excluded';
import { REGION_ROLES } from '@webable/core/page/types';
import {
  articleSignals,
  evidence,
  makeRegion,
  workedExamplePage,
} from '@webable/core/policy/fixtures';
import type { RegionAnswer } from '@webable/core/decide/wire';
import { JEV_PINNED_MODEL, CATALOG_VERSION } from '@webable/core/versions';
import { describe, expect, it, vi } from 'vitest';

import type { PageEvidence } from '../protocol';
import {
  analysisView,
  buildDecideRequest,
  cacheEntries,
  callDecide,
  keyAnswers,
  MAX_REGIONS,
  type DecideOk,
} from './analysis';

function roles(
  top: (typeof REGION_ROLES)[number],
  p = 0.9,
): RegionAnswer['role'] {
  const rest = (1 - p) / (REGION_ROLES.length - 1);
  return Object.fromEntries(
    REGION_ROLES.map((r) => [r, r === top ? p : rest]),
  ) as RegionAnswer['role'];
}

const EVIDENCE: PageEvidence = {
  page: workedExamplePage(),
  regions: {
    'k-rail': evidence(),
    'k-other': evidence({ zone: 'left_rail', class_words: ['promo'] }),
    'k-a': evidence({ class_words: ['main'] }),
    'k-b': evidence({ class_words: ['article'] }),
  },
  mainCandidates: ['k-a', 'k-b'],
};

describe('the request that leaves the device', () => {
  it('holds vocabulary-filtered evidence only, with ephemeral ids', () => {
    const built = buildDecideRequest(EVIDENCE, {
      regionKeys: ['k-rail', 'k-other'],
      mainCandidates: ['k-a', 'k-b'],
      askPageType: true,
    });
    expect(built).not.toBeNull();
    const body = JSON.parse(built!.body) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      'ask',
      'catalog',
      'lang',
      'mainCandidates',
      'page',
      'regions',
      'v',
    ]);
    expect(body.catalog).toBe(CATALOG_VERSION);
    expect(built!.ridToKey).toEqual({ r0: 'k-rail', r1: 'k-other' });
    expect(built!.cidToKey).toEqual({ c1: 'k-a', c2: 'k-b' });
    // No component keys, URLs or profile values in what is sent.
    expect(built!.body).not.toMatch(
      /k-rail|k-other|k-a|k-b|http|profile|textMinPx/,
    );
  });

  it('asks at most 10 regions and never a main candidate as a region', () => {
    const regions: PageEvidence['regions'] = {};
    for (let i = 0; i < 14; i++) regions[`k${i}`] = evidence();
    const built = buildDecideRequest(
      { page: workedExamplePage(), regions },
      {
        regionKeys: Object.keys(regions),
        mainCandidates: ['k0', 'k1'],
        askPageType: false,
      },
    );
    expect(built!.request.regions).toHaveLength(MAX_REGIONS);
    expect(Object.values(built!.ridToKey)).not.toContain('k0');
  });

  it('sends nothing when there is nothing to ask, or when evidence breaks the contract', () => {
    expect(
      buildDecideRequest(EVIDENCE, { regionKeys: [], askPageType: false }),
    ).toBeNull();
    const bad: PageEvidence = {
      page: workedExamplePage(),
      regions: {
        k: {
          ...evidence(),
          heading_words: 'x'.repeat(5000),
          secret: 'page text',
        } as never,
      },
    };
    expect(
      buildDecideRequest(bad, { regionKeys: ['k'], askPageType: false }),
    ).toBeNull();
  });

  it('sends nothing when a word is outside the vocabulary or a phrase is too long', () => {
    const ask = (ev: PageEvidence['regions'][string]) =>
      buildDecideRequest(
        { page: workedExamplePage(), regions: { k: ev } },
        { regionKeys: ['k'], askPageType: false },
      );
    expect(ask(evidence())).not.toBeNull();
    expect(ask(evidence({ class_words: ['zzqx'] }))).toBeNull();
    expect(ask(evidence({ heading_words: 'welcome back caden' }))).toBeNull();
    const menu = (n: number) =>
      Array.from({ length: n }, () => 'menu').join(' ');
    expect(ask(evidence({ heading_words: menu(6) }))).not.toBeNull();
    expect(ask(evidence({ heading_words: menu(7) }))).toBeNull();
    expect(ask(evidence({ control_words: [menu(5)] }))).toBeNull();
    // A main candidate is checked the same way.
    expect(
      buildDecideRequest(
        {
          page: workedExamplePage(),
          regions: {
            a: evidence(),
            b: evidence({ class_words: ['zzqx'] }),
          },
        },
        { regionKeys: [], mainCandidates: ['a', 'b'], askPageType: false },
      ),
    ).toBeNull();
  });
});

describe('calling decide', () => {
  const ok: DecideOk = {
    v: 1,
    ok: true,
    catalog: CATALOG_VERSION,
    model: JEV_PINNED_MODEL,
    regions: { r0: { role: roles('promo_ad'), task: 0.05 } },
    inputTokens: 900,
    ms: { jev: 90, edge: 20 },
  };
  const respond = (status: number, body: unknown) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status }));
  const call = (fetch: typeof globalThis.fetch) =>
    callDecide({
      url: 'https://x/functions/v1/decide',
      publishableKey: 'pk',
      accessToken: 'jwt',
      body: '{}',
      timeoutMs: 3000,
      fetch,
    });

  it('sends the JWT and the publishable key, no cookies or referrer', async () => {
    const fetch = respond(200, ok);
    const out = await call(fetch as unknown as typeof globalThis.fetch);
    expect(out.ok).toBe(true);
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers).toMatchObject({
      authorization: 'Bearer jwt',
      apikey: 'pk',
    });
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('maps every failure to a reason, never throwing', async () => {
    const reason = async (fetch: unknown) => {
      const out = await call(fetch as typeof globalThis.fetch);
      return out.ok ? 'ok' : out.reason;
    };
    expect(await reason(respond(401, {}))).toBe('unauthorized');
    expect(
      await reason(respond(403, { error: { code: 'consent_required' } })),
    ).toBe('consent_required');
    expect(await reason(respond(403, { error: { code: 'other' } }))).toBe(
      'http',
    );
    expect(
      await reason(
        respond(429, {
          v: 1,
          ok: false,
          degraded: 'rate_limited',
          retryAfterMs: 2000,
        }),
      ),
    ).toBe('rate_limited');
    expect(await reason(respond(503, 'down'))).toBe('http');
    expect(await reason(respond(200, { ...ok, model: 'jev-9.0.0' }))).toBe(
      'model_drift',
    );
    expect(await reason(respond(200, { nonsense: true }))).toBe('shape');
    expect(
      await reason(
        vi.fn(async () => {
          throw new TypeError('Failed to fetch');
        }),
      ),
    ).toBe('network');
    expect(
      await reason(
        vi.fn(async () => {
          throw new DOMException('timed out', 'TimeoutError');
        }),
      ),
    ).toBe('timeout');
  });

  it('keeps a server retry-after for the breaker', async () => {
    const out = await call(
      respond(429, {
        v: 1,
        ok: false,
        degraded: 'quota',
        retryAfterMs: 60_000,
      }) as unknown as typeof fetch,
    );
    expect(out).toMatchObject({
      ok: false,
      reason: 'quota',
      retryAfterMs: 60_000,
    });
  });

  it('rejects success-shaped error responses and honours gateway retry headers', async () => {
    expect(
      await call(respond(503, ok) as unknown as typeof fetch),
    ).toMatchObject({ ok: false, reason: 'http' });
    const fetcher = vi.fn(
      async () =>
        new Response('gateway busy', {
          status: 429,
          headers: { 'retry-after': '3' },
        }),
    );
    expect(await call(fetcher as unknown as typeof fetch)).toMatchObject({
      ok: false,
      reason: 'rate_limited',
      retryAfterMs: 3000,
    });
  });

  it('counts body latency and identifies body-read deadline failures as timeouts', async () => {
    const fetcher = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => {
        throw new DOMException('Body timed out', 'TimeoutError');
      },
    })) as unknown as typeof fetch;
    expect(await call(fetcher)).toMatchObject({ ok: false, reason: 'timeout' });
  });
});

describe('answers into verdicts and the cache', () => {
  const data: DecideOk = {
    v: 1,
    ok: true,
    catalog: CATALOG_VERSION,
    model: JEV_PINNED_MODEL,
    regions: {
      r0: { role: roles('promo_ad'), task: 0.05 },
      r1: { role: roles('help_contact'), task: 0.7 },
    },
    mainPick: { c1: 0.9, c2: 0.08, none: 0.02 },
    pageType: { article: 0.9, other: 0.1 } as DecideOk['pageType'],
    inputTokens: 1,
    ms: { jev: 1, edge: 1 },
  };

  it('re-keys answers by component key and builds cache records', () => {
    const keyed = keyAnswers(
      data,
      { r0: 'k-rail', r1: 'k-other' },
      { c1: 'k-a', c2: 'k-b' },
    );
    expect([...keyed.regions.keys()]).toEqual(['k-rail', 'k-other']);
    expect(keyed.main).toEqual({ 'k-a': 0.9, 'k-b': 0.08, none: 0.02 });
    const entries = cacheEntries(keyed, {
      region: new Map([
        ['k-rail', 'h1'],
        ['k-other', 'h2'],
      ]),
      main: 'hm',
      page: 'hp',
    });
    expect(entries.map(([k, v]) => [k, v.kind])).toEqual([
      ['h1', 'region'],
      ['h2', 'region'],
      ['hm', 'main'],
      ['hp', 'page'],
    ]);
  });

  it('uses local rules alone without answers', () => {
    const signals = articleSignals();
    const view = analysisView(signals, {}, null);
    expect(view.used).toBe(false);
    expect(view.signals).toBe(signals);
    expect(view.verdicts['k-ad']?.source).toBe('rule');
  });

  it('protects what the answers say a visitor needs, and applies a clear main pick', () => {
    const signals = articleSignals({}, [
      makeRegion('k-rail'),
      makeRegion('k-other'),
      makeRegion('k-a', { zone: 'center_column', areaPct: 40 }),
      makeRegion('k-b', { zone: 'center_column', areaPct: 30 }),
    ]);
    const keyed = keyAnswers(
      data,
      { r0: 'k-rail', r1: 'k-other' },
      { c1: 'k-a', c2: 'k-b' },
    );
    const view = analysisView(signals, EVIDENCE.regions, keyed);
    expect(view.used).toBe(true);
    // A region the main task needs is never softened.
    expect(view.protectedKeys.has('k-other')).toBe(true);
    expect(view.verdicts['k-other']).toMatchObject({
      source: 'page_analysis',
      protected: true,
    });
    expect(view.verdicts['k-rail']?.source).toBe('page_analysis');
    expect(view.main?.key).toBe('k-a');
    expect(view.signals.main.key).toBe('k-a');
  });
});

describe('excluded sites', () => {
  it('the worker asks the default exclusion list, never a constant', () => {
    // G3 (ai-architecture.md 3.1): a hardcoded `excludedSite: false` would send
    // banking and health pages for analysis.
    const here = dirname(fileURLToPath(import.meta.url));
    const worker = readFileSync(join(here, 'worker.ts'), 'utf8');
    const uses = worker.match(/excludedSite:\s*([^,\n]+)/g) ?? [];
    // Page analysis (G3) and layout planning both ask the list.
    expect(uses.length).toBeGreaterThanOrEqual(2);
    expect(new Set(uses)).toEqual(
      new Set(['excludedSite: isExcludedSite(domain)']),
    );
    expect(isExcludedSite('chase.com')).toBe(true);
    expect(isExcludedSite('example.com')).toBe(false);
  });
});
