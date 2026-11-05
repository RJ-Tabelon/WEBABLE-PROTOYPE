// Pure server helpers and request guards. No network: Jev and OpenAI are never called here.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FitSpec, LayoutCandidate, PageOutline } from '@webable/core';
import { createApp } from '../src/app';
import { hostAllowed, originAllowed, rateCheck, resetRateLimits } from '../src/guard';
import { TtlLru } from '../src/lru';
import { fitToText, limitsFor, outlineToText, trimOutline } from '../src/prompts';
import { unfoldAll } from '../src/routes/redesign';
import { normalizeAssets } from '../src/routes/visual';
import { cleanShape } from '../src/sanitize';
import { FIXTURE_DIGEST, FIXTURE_FIT, FIXTURE_OUTLINE, fixtureVisual } from '../src/fixtures';
import { imageFormatOf, jevImageProblem, pngSize, splitSentences } from '../src/text';
import { canonicalJson } from '../src/util';

const spec = (states: Array<FitSpec['sections'][number]['state']>, primaryAt = 0): FitSpec => ({
  page_type: 'form',
  task: 'fill_form',
  strip: [],
  primary_action: 'n1',
  form_steps: [],
  density: 'airy',
  sections: states.map((state, i) => ({
    heading_ref: null,
    label: i === primaryAt ? 'Overview' : 'Details',
    role: i === primaryAt ? 'primary' : 'supporting',
    nodes: [`n${i + 1}`],
    layout: 'as_is',
    emphasis: 'normal',
    state,
    why: 'main_task',
    show_first: 0,
  })),
});

describe('splitSentences', () => {
  it('splits the fine print into its six sentences', () => {
    const s = splitSentences(
      'By selecting Confirm refill, you authorize the pharmacy to bill your insurance on file. Your copay may differ from the estimate shown. Refills of controlled substances may require pharmacist review and can be delayed up to 1 business day. Orders placed after 6 PM are processed the next business day. Prices shown are estimates and do not include applicable taxes. Generic substitution may occur unless your prescriber indicates otherwise.',
    );
    expect(s).toHaveLength(6);
    expect(s[3]).toBe('Orders placed after 6 PM are processed the next business day.');
  });
  it('keeps abbreviations and placeholders inside a sentence', () => {
    expect(splitSentences('Call Dr. [name] at [phone]. Then wait e.g. two days.')).toEqual(['Call Dr. [name] at [phone].', 'Then wait e.g. two days.']);
  });
  it('joins tiny fragments and caps the count', () => {
    expect(splitSentences('Done. Ok. Then the next sentence follows here.')).toEqual(['Done. Ok.', 'Then the next sentence follows here.']);
    const many = Array.from({ length: 40 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
    expect(splitSentences(many, 24)).toHaveLength(24);
  });
});

describe('unfoldAll', () => {
  it('opens the flagged drawer and moves it right after the primary section', () => {
    const cand: LayoutCandidate = { name: 'focus', spec: spec(['open', 'open', 'collapsed', 'end_drawer']), repairs: [] };
    const [out] = unfoldAll([cand], [{ candidate: 'focus', sectionIndex: 3 }]);
    expect(out!.spec.sections.map((s) => [s.nodes[0], s.state])).toEqual([
      ['n1', 'open'],
      ['n4', 'open'],
      ['n2', 'open'],
      ['n3', 'collapsed'],
    ]);
    expect(out!.repairs).toHaveLength(1);
  });
  it('leaves other candidates and open sections alone', () => {
    const a: LayoutCandidate = { name: 'guided', spec: spec(['open', 'collapsed']), repairs: [] };
    const b: LayoutCandidate = { name: 'focus', spec: spec(['open', 'open']), repairs: [] };
    const out = unfoldAll([a, b], [{ candidate: 'focus', sectionIndex: 1 }]);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });
});

describe('prompt input', () => {
  it('renders the outline as an indented tree with roles and protection', () => {
    const text = outlineToText(FIXTURE_OUTLINE);
    expect(text.split('\n')[0]).toBe(`PAGE nodes=${FIXTURE_OUTLINE.nodes.length} type_hint=form`);
    expect(text).toContain('\n  n19 button "Confirm refill" jev=action_button');
    expect(text).toContain('n20 link "Call your pharmacist" shape="phone" jev=help_contact protected');
    expect(text.split('\n')).toHaveLength(FIXTURE_OUTLINE.nodes.length + 1);
  });
  it('trims the deepest nodes first and keeps document order', () => {
    const t = trimOutline(FIXTURE_OUTLINE, 10);
    expect(t.nodes).toHaveLength(10);
    expect(t.nodes.every((n) => !n.parent)).toBe(true);
    const order = FIXTURE_OUTLINE.nodes.map((n) => n.id);
    expect(t.nodes.map((n) => order.indexOf(n.id))).toEqual([...t.nodes.map((n) => order.indexOf(n.id))].sort((a, b) => a - b));
  });
  it('sends coarse fit levels and the limits, never measurements', () => {
    const text = fitToText(FIXTURE_FIT);
    expect(text).toContain('limits: open_sections_max=3 list_first=4 form_step_max_fields=5');
    expect(text).not.toMatch(/px|\d{2,}/);
    expect(limitsFor({ ...FIXTURE_FIT, structure_level: 0 }).open_sections_max).toBeGreaterThan(3);
  });
});

describe('shapes', () => {
  it('keeps code-written shapes and filters anything else', () => {
    expect(cleanShape('list x12')).toBe('list x12');
    expect(cleanShape('paragraph x5')).toBe('paragraph x5');
    expect(cleanShape('price')).toBe('price');
    expect(cleanShape('Rosa Diaz')).not.toContain('Rosa');
  });
});

describe('images', () => {
  it('reads PNG sizes and enforces Jev limits', async () => {
    const v = await fixtureVisual();
    expect(imageFormatOf(v.before)).toBe('png');
    expect(pngSize(v.before)).toEqual({ width: 1280, height: 800 });
    expect(jevImageProblem(v.before, 'before')).toBeNull();
    expect(jevImageProblem('aGVsbG8gd29ybGQ=', 'x')).toMatch(/not a PNG/);
  });
  it('normalises assets to the Jev format', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAA';
    const out = normalizeAssets({ a: { type: 'image', media_type: 'image/png', data: png }, b: { format: 'png', data_base64: `data:image/png;base64,${png}` } });
    expect(out.a).toEqual({ type: 'image', format: 'png', data_base64: png });
    expect(out.b!.data_base64).toBe(png);
  });
});

describe('cache and hashing', () => {
  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }));
  });
  it('LRU evicts the oldest, expires, and joins identical work in flight', async () => {
    const c = new TtlLru<number>(2, 60_000);
    c.set('a', 1);
    c.set('b', 2);
    c.get('a');
    c.set('c', 3);
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    let runs = 0;
    const make = async () => {
      runs++;
      await new Promise((r) => setTimeout(r, 10));
      return 7;
    };
    const [x, y] = await Promise.all([c.getOrMake('k', make), c.getOrMake('k', make)]);
    expect(runs).toBe(1);
    expect([x.fromCache, y.fromCache]).toEqual([false, true]);
    const skip = await c.getOrMake('z', async () => 9, { keep: () => false });
    expect(skip.value).toBe(9);
    expect(c.get('z')).toBeUndefined();
  });
});

describe('guards and validation (no model calls)', () => {
  const app = createApp();
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });

  it('accepts the extension and local pages only', () => {
    expect(originAllowed('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).toBe(true);
    expect(originAllowed('http://127.0.0.1:41741')).toBe(true);
    expect(originAllowed('https://evil.example')).toBe(false);
    expect(originAllowed('http://localhost:3000')).toBe(false);
    expect(originAllowed(undefined)).toBe(true);
  });
  it('rejects foreign hosts, foreign origins and non-JSON posts', async () => {
    expect((await app.request('/health', { headers: { Host: 'evil.example:41741' } })).status).toBe(403);
    expect((await post('/v1/understand', { digest: FIXTURE_DIGEST }, { Origin: 'https://evil.example' })).status).toBe(403);
    const plain = await app.request('/v1/understand', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
    expect(plain.status).toBe(415);
  });
  it('names the field at fault without echoing values', async () => {
    const r = await post('/v1/understand', { digest: { ...FIXTURE_DIGEST, elements: [{ ...FIXTURE_DIGEST.elements[0], zone: 'nowhere' }] } });
    expect(r.status).toBe(400);
    const j = (await r.json()) as { error: string; details: string[] };
    expect(j.error).toBe('invalid_body');
    expect(j.details.join(' ')).toContain('digest.elements.0.zone');
    expect(JSON.stringify(j)).not.toContain('nowhere');
  });
  it('refuses an empty outline', async () => {
    const empty: PageOutline = { v: 'outline.1', nodes: [] };
    const r = await post('/v1/redesign', { outline: empty, fit: FIXTURE_FIT, roles: {} });
    expect(r.status).toBe(422);
  });
  it('allows the extension preflight and withholds it from other sites', async () => {
    const pre = (origin: string) =>
      app.request('/v1/understand', { method: 'OPTIONS', headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' } });
    expect((await pre('chrome-extension://abcdefghijklmnopabcdefghijklmnop')).headers.get('access-control-allow-origin')).toBe(
      'chrome-extension://abcdefghijklmnopabcdefghijklmnop',
    );
    expect((await pre('https://evil.example')).headers.get('access-control-allow-origin')).toBeNull();
  });
});

describe('public deployment guards (WEBABLE_PUBLIC=1)', () => {
  const SITE = 'https://webable.example';
  const HOST = 'webable-ai.example.app';
  const app = createApp();
  const post = (headers: Record<string, string>) =>
    app.request('/v1/understand', { method: 'POST', headers: { 'Content-Type': 'application/json', Host: HOST, ...headers }, body: JSON.stringify({}) });
  const pre = (origin: string) =>
    app.request('/v1/understand', { method: 'OPTIONS', headers: { Host: HOST, Origin: origin, 'Access-Control-Request-Method': 'POST' } });

  beforeEach(() => {
    vi.stubEnv('WEBABLE_PUBLIC', '1');
    vi.stubEnv('WEBABLE_HOSTS', HOST);
    vi.stubEnv('ALLOWED_ORIGINS', `${SITE}/`);
    vi.stubEnv('RATE_LIMIT_PER_MIN', '3');
    resetRateLimits();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetRateLimits();
  });

  it('answers on the deployed host and still on loopback, not elsewhere', async () => {
    expect(hostAllowed(HOST)).toBe(true);
    expect(hostAllowed('127.0.0.1:41741')).toBe(true);
    expect(hostAllowed('evil.example')).toBe(false);
    expect((await app.request('/health', { headers: { Host: HOST } })).status).toBe(200);
    expect((await app.request('/health', { headers: { Host: 'evil.example' } })).status).toBe(403);
  });
  it('grants an allowed origin its preflight and refuses other sites', async () => {
    expect((await pre(SITE)).headers.get('access-control-allow-origin')).toBe(SITE);
    expect((await pre('https://example.com')).headers.get('access-control-allow-origin')).toBeNull();
    expect((await post({ Origin: 'https://example.com' })).status).toBe(403);
  });
  it('refuses a POST with no Origin', async () => {
    const r = await post({});
    expect(r.status).toBe(403);
    expect(((await r.json()) as { error: string }).error).toBe('bad_origin');
  });
  it('limits each IP and leaves other IPs alone', async () => {
    for (let i = 0; i < 3; i++) expect((await post({ Origin: SITE, 'x-real-ip': '1.2.3.4' })).status).toBe(400);
    const limited = await post({ Origin: SITE, 'x-real-ip': '1.2.3.4' });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
    expect(limited.headers.get('access-control-allow-origin')).toBe(SITE);
    expect((await post({ Origin: SITE, 'x-real-ip': '5.6.7.8' })).status).toBe(400);
  });
  it('opens a new minute window', () => {
    const t = Date.UTC(2026, 10, 2, 12, 0, 30);
    for (let i = 0; i < 3; i++) expect(rateCheck('9.9.9.9', t)).toBe(0);
    expect(rateCheck('9.9.9.9', t)).toBe(30);
    expect(rateCheck('9.9.9.9', t + 30_000)).toBe(0);
  });
  it('changes nothing locally', () => {
    vi.unstubAllEnvs();
    expect(originAllowed(undefined)).toBe(true);
    expect(hostAllowed(HOST)).toBe(false);
    expect(originAllowed(SITE)).toBe(false);
  });
});
