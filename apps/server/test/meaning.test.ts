// Round 7 package J: /v1/meaning and the round-7 digest on /v1/understand. No network: Jev is never called here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { ElementEvidence } from '@webable/core';
import { createApp } from '../src/app';
import { FIXTURE_DIGEST } from '../src/fixtures';
import { MeaningBody, registerMeaning } from '../src/routes/meaning';
import { UnderstandBodyV2, needsCaution, sanitizeRegions } from '../src/routes/understand';

const saved = process.env.TYPESAFE_API_KEY;
beforeEach(() => {
  delete process.env.TYPESAFE_API_KEY;
});
afterEach(() => {
  if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
  else process.env.TYPESAFE_API_KEY = saved;
});

const REQ = {
  purpose: 'record_stats',
  original: { mainRegion: 'main region: scoreboard, stat_value', leadRoles: ['scoreboard', 'stat_value'], mustKeep: ['scoreboard', 'stat_value', 'team_or_org_logo'] },
  calm: { leadRoles: ['page_title', 'scoreboard'], shownRoles: ['page_title', 'scoreboard', 'stat_value', 'team_or_org_logo'], foldedRoles: ['teaser_other_content'] },
};

function app(): Hono {
  const a = createApp();
  registerMeaning(a);
  return a;
}
const post = (a: Hono, path: string, body: unknown) =>
  a.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

describe('POST /v1/meaning', () => {
  it('validates the body and names the field at fault', async () => {
    const r = await post(app(), '/v1/meaning', { req: { ...REQ, calm: { leadRoles: 'scoreboard' } } });
    expect(r.status).toBe(400);
    expect(JSON.stringify(await r.json())).toContain('calm');
  });

  it('refuses a request with nothing to compare (422) before asking Jev', async () => {
    const r = await post(app(), '/v1/meaning', { req: { ...REQ, original: { mainRegion: '', leadRoles: ['Wins 54'], mustKeep: [] } } });
    expect(r.status).toBe(422);
  });

  it('fails closed when Jev is not configured', async () => {
    const r = await post(app(), '/v1/meaning', { req: REQ });
    expect(r.status).toBe(503);
    expect(((await r.json()) as { error: string }).error).toBe('jev_unavailable');
  });

  it('strips unknown keys', () => {
    const parsed = MeaningBody.parse({ req: { ...REQ, pageText: 'Wins 54', calm: { ...REQ.calm, extra: 1 } } });
    expect('pageText' in parsed.req).toBe(false);
    expect('extra' in parsed.req.calm).toBe(false);
  });
});

describe('POST /v1/understand with content regions', () => {
  const region: ElementEvidence = { ...FIXTURE_DIGEST.elements[0]!, id: 'n900', label: 'Call (352) 555-0147 for help' };

  it('keeps regions through validation and strips unknown keys', () => {
    const p = UnderstandBodyV2.parse({ digest: { ...FIXTURE_DIGEST, regions: [{ ...region, junk: 1 }], junk: 2 } });
    expect(p.digest.regions).toHaveLength(1);
    expect('junk' in p.digest).toBe(false);
    expect('junk' in p.digest.regions![0]!).toBe(false);
    expect(UnderstandBodyV2.safeParse({ digest: { ...FIXTURE_DIGEST, regions: [{ ...region, zone: 'nowhere' }] } }).success).toBe(false);
  });

  it('redacts region labels like element labels, and drops an empty list', () => {
    const { regions, changed } = sanitizeRegions([region]);
    expect(changed).toBe(1);
    expect(regions![0]!.label).not.toContain('555-0147');
    expect(sanitizeRegions([]).regions).toBeUndefined();
  });

  it('counts off-site links in regions for the caution line', () => {
    expect(needsCaution({ ...FIXTURE_DIGEST, elements: [], regions: [{ ...region, link_target: 'another website' }] })).toBe(true);
  });

  it('accepts a digest with regions (it then needs Jev)', async () => {
    const r = await post(createApp(), '/v1/understand', { digest: { ...FIXTURE_DIGEST, regions: [region] } });
    expect(r.status).toBe(503);
  });
});
