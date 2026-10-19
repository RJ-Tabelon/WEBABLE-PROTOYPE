import { describe, expect, it } from 'vitest';

import { tier0Profile } from '../policy/fixtures';
import type { LatentDim } from '../profile/schema';
import { solveStructure } from './solver';
import { structureNeed } from './structure';

const evidenced = (mean: number, sd: number): LatentDim => ({
  mean,
  sd,
  confidence: 0.6,
  sources: ['behavior'],
});

describe('structureNeed', () => {
  it('is 0 when Tune never informed a structure dimension', () => {
    const need = structureNeed(tier0Profile());
    expect(need.level).toBe(0);
    expect(need.p).toBe(0);
    expect(Object.values(need.dims).every((d) => d === null)).toBe(true);
  });

  it('takes the strongest informed dimension, gated on the posterior', () => {
    const p = tier0Profile();
    // Mean says benefit, evidence is weak: P ≈ 0.69, an offer.
    p.attention.chunking = evidenced(0.3, 0.6);
    expect(structureNeed(p).level).toBe(1);
    // Strong evidence on another dimension: restructure automatically.
    p.attention.density = evidenced(0.5, 0.2);
    const need = structureNeed(p);
    expect(need.level).toBe(2);
    expect(need.dims.density).toBeGreaterThanOrEqual(0.8);
    expect(need.dims.guidance).toBeNull();
    // Measured to make no difference: nothing changes.
    const q = tier0Profile();
    q.attention.distraction = evidenced(-0.4, 0.2);
    expect(structureNeed(q).level).toBe(0);
  });
});

describe('solveStructure', () => {
  it('maps each Focus effect to its own change', () => {
    const p = tier0Profile();
    p.attention.chunking = evidenced(0.5, 0.2);
    expect(solveStructure(p)).toMatchObject({
      level: 2,
      groupEvery: 4,
      splitSentences: 3,
      // Chunking alone does not hide records or sections.
      listFirst: null,
      sectionsOpen: null,
    });
    const q = tier0Profile();
    q.attention.distraction = evidenced(0.5, 0.2);
    expect(solveStructure(q)).toMatchObject({
      listFirst: 8,
      sectionsOpen: 1,
      groupEvery: 6,
      splitSentences: null,
      outline: true,
    });
    const r = tier0Profile();
    r.attention.guidance = evidenced(0.3, 0.6);
    expect(solveStructure(r)).toMatchObject({ level: 1, outline: true });
  });
});
