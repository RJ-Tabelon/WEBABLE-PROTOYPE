import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicFile, webpSize } from '../webp-size.test-util';
import { CAPTURE_SIZE, HERO_SITES, isSizeChange } from './captures';

describe('the hero screenshots', () => {
  it('has a picture as made and a fitted picture for every site', () => {
    expect(HERO_SITES.length).toBeGreaterThanOrEqual(2);
    for (const site of HERO_SITES)
      for (const shot of [site.original, site.fitted]) {
        const file = publicFile(shot.src);
        expect(statSync(file).size).toBeLessThan(400_000);
        expect(webpSize(file)).toEqual(CAPTURE_SIZE);
        expect(shot.alt.length).toBeGreaterThan(40);
      }
  });

  it('describes each picture as the site made it, then with WebAble on', () => {
    for (const site of HERO_SITES) {
      expect(site.original.alt).toContain('as the site made it');
      expect(site.fitted.alt).toMatch(
        /^The same (page|story) with WebAble on[:,] /,
      );
    }
  });

  it('lists what WebAble did, in the extension’s own words', () => {
    const labels = new Set(['Text size', 'Click targets']);
    for (const site of HERO_SITES) {
      expect(site.changes.length).toBeGreaterThan(0);
      for (const c of site.changes) {
        if (isSizeChange(c)) {
          expect(labels.has(c.label)).toBe(true);
          expect(c.to).toBeGreaterThan(c.from);
        } else {
          // One plain sentence, as the ledger says it: no "!", no trailing stop.
          expect(c.said).toMatch(/^[A-Z][^!]+[^.]$/);
        }
      }
    }
  });
});
