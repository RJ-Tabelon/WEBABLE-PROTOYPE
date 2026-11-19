import { statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { publicFile, webpSize } from '../webp-size.test-util';
import { FIT_PEOPLE, FITS_SHOT_SIZE, isDoneChange } from './fits';
import { LENS_SHOT } from './lens';

describe('the home page screenshots', () => {
  it('has one picture of the same NPR passage for each person', () => {
    expect(FIT_PEOPLE).toHaveLength(3);
    for (const person of FIT_PEOPLE) {
      const file = publicFile(person.shot.src);
      expect(statSync(file).size).toBeLessThan(250_000);
      expect(webpSize(file)).toEqual(FITS_SHOT_SIZE);
      expect(person.shot.alt.length).toBeGreaterThan(40);
      expect(person.changes.length).toBeGreaterThan(1);
      for (const c of person.changes)
        if (isDoneChange(c)) expect(c.said).toMatch(/^[A-Z][^!]+[^.]$/);
    }
  });

  it('has the Jev Lens picture at its stated size', () => {
    const file = publicFile(LENS_SHOT.src);
    expect(statSync(file).size).toBeLessThan(400_000);
    expect(webpSize(file)).toEqual({
      width: LENS_SHOT.width,
      height: LENS_SHOT.height,
    });
  });
});
