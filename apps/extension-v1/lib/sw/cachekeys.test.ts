// @vitest-environment node
import { govuk } from '@webable/core/compose/__fixtures__/index';
import type { PageContext, RegionEvidence } from '@webable/core/page/types';
import { nameKey } from '@webable/core/skeleton/locate';
import { pathShape } from '@webable/core/skeleton/template';
import {
  COMPOSE_PINNED_MODEL,
  COMPOSE_SCHEMA_VERSION,
} from '@webable/core/versions';
import { describe, expect, it } from 'vitest';

import { freshSecret } from '../storage/install';
import { canonicalJson, hmacHex } from '../storage/crypto';
import {
  composeKey,
  nameHash,
  nameHasher,
  pageAnswerKey,
  pageSignature,
  regionAnswerKey,
  siteKey,
  templateKey,
} from './cachekeys';

const PAGE: PageContext = {
  signals: ['has_article_markup', 'has_main_landmark'],
  main: { found_by: 'main_element', zone: 'center_column' },
  counts: {
    headings: '4-10',
    forms: '0',
    buttons: '1-3',
    links: '11-30',
    images: '1-3',
    iframes: '0',
    videos: '0',
  },
  layout: {
    viewport: 'desktop',
    page_height: '3-10 screens',
    pinned_bars: '1',
  },
} as unknown as PageContext;

function ev(
  words: string[],
  extra: Partial<RegionEvidence> = {},
): RegionEvidence {
  return {
    zone: 'right_rail',
    landmark: 'aside',
    tag: 'aside',
    pinned: 'no',
    class_words: words,
    ...extra,
  } as unknown as RegionEvidence;
}

describe('answer-cache keys', () => {
  it('are deterministic for one install and differ across installs', async () => {
    const a = freshSecret();
    const b = freshSecret();
    expect(await siteKey(a, 'example.com')).toBe(
      await siteKey(a, 'example.com'),
    );
    expect(await siteKey(a, 'example.com')).not.toBe(
      await siteKey(b, 'example.com'),
    );
    expect(await siteKey(a, 'example.com')).toMatch(/^[0-9a-f]{16}$/);
  });

  it('never contain the domain or the component key', async () => {
    const s = freshSecret();
    const site = await siteKey(s, 'example.com');
    const key = await regionAnswerKey(s, site, 'c1abc');
    expect(key).toMatch(/^[0-9a-f]{32}$/);
    expect(key).not.toContain('example');
    expect(key).not.toContain('c1abc');
  });

  it('change with the component, the site and the model', async () => {
    const s = freshSecret();
    const site = await siteKey(s, 'a.com');
    const other = await siteKey(s, 'b.com');
    const k = await regionAnswerKey(s, site, 'k1');
    expect(await regionAnswerKey(s, site, 'k2')).not.toBe(k);
    expect(await regionAnswerKey(s, other, 'k1')).not.toBe(k);
    expect(await regionAnswerKey(s, site, 'k1', 'jev-9.9.9')).not.toBe(k);
  });

  it('separate their parts so neighbouring values cannot collide', async () => {
    const s = freshSecret();
    expect(await hmacHex(s, ['ab', 'c'])).not.toBe(
      await hmacHex(s, ['a', 'bc']),
    );
  });
});

describe('page signature', () => {
  it('is the same for every page of one template (counts and heading words aside)', () => {
    const one = pageSignature(PAGE, {
      a: ev(['sidebar', 'promo']),
      b: ev(['nav']),
    });
    const two = pageSignature(
      { ...PAGE, counts: { ...PAGE.counts, links: '31-100' } } as PageContext,
      { x: ev(['nav']), y: ev(['promo', 'sidebar']) },
    );
    expect(one).toBe(two);
  });

  it('changes when the structure changes', () => {
    const one = pageSignature(PAGE, { a: ev(['sidebar']) });
    const two = pageSignature(PAGE, {
      a: ev(['sidebar'], { pinned: 'sticky' }),
    });
    expect(one).not.toBe(two);
  });

  it('keys page answers by kind, signature and candidates', async () => {
    const s = freshSecret();
    const site = await siteKey(s, 'a.com');
    const sig = pageSignature(PAGE, {});
    const page = await pageAnswerKey(s, site, 'page', sig);
    const main = await pageAnswerKey(s, site, 'main', sig, ['k1', 'k2']);
    expect(page).not.toBe(main);
    expect(await pageAnswerKey(s, site, 'main', sig, ['k1', 'k3'])).not.toBe(
      main,
    );
  });
});

describe('canonical JSON', () => {
  it('sorts object keys at every depth and drops undefined', () => {
    expect(
      canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } }),
    ).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});

describe('v2 keys: templates, planner specs and names', () => {
  it('keys a template by site and path shape, never by the URL itself', async () => {
    const secret = freshSecret();
    const site = await siteKey(secret, 'example.com');
    const a = await templateKey(
      secret,
      site,
      pathShape('https://example.com/wiki/Alan_Turing'),
    );
    const b = await templateKey(
      secret,
      site,
      pathShape('https://example.com/wiki/Ada?x=1'),
    );
    const c = await templateKey(
      secret,
      site,
      pathShape('https://example.com/search?q=x'),
    );
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(await templateKey(freshSecret(), site, '/wiki/*')).not.toBe(a);
  });

  it('keys planner specs by site, path shape, schema and model', async () => {
    const secret = freshSecret();
    const site = await siteKey(secret, 'example.com');
    const k = await composeKey(secret, site, '/wiki/*');
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(k).toBe(
      await hmacHex(
        secret,
        [
          'compose',
          site,
          '/wiki/*',
          COMPOSE_SCHEMA_VERSION,
          COMPOSE_PINNED_MODEL,
        ],
        16,
      ),
    );
    expect(await composeKey(secret, site, '/wiki/*', 'other-model')).not.toBe(
      k,
    );
    expect(await composeKey(secret, site, '/search')).not.toBe(k);
    // Never the same as a template key for the same parts.
    expect(k.startsWith(await templateKey(secret, site, '/wiki/*'))).toBe(
      false,
    );
  });

  it('hashes every label of a skeleton ahead of time, counts and case folded', async () => {
    const secret = freshSecret();
    const hash = await nameHasher(secret, govuk);
    const labelled = govuk.nodes.find((n) => n.label && /\w/.test(n.label))!;
    const key = nameKey(labelled.label!);
    expect(hash(key)).toBe(await nameHash(secret, key));
    expect(hash(key)).toMatch(/^[0-9a-f]{16}$/);
    expect(hash('a label not on this page')).toBe('');
    expect(nameKey('3 Items')).toBe(nameKey('12 items'));
  });
});
