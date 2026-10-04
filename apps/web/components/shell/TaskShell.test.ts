import { describe, expect, it } from 'vitest';
import { progressLine } from './TaskShell';

describe('progressLine', () => {
  it('binds each separator dot to the word before it', () => {
    const line = progressLine('Part 1 of 3 · Reading · about 6 min left');
    expect(line).toBe('Part 1 of 3\u00a0· Reading\u00a0· about 6 min left');
    // No line can start with the dot: every "·" follows a no-break space.
    expect(line).not.toMatch(/ ·/);
  });

  it('leaves text without separators alone', () => {
    expect(progressLine('About 6 min left')).toBe('About 6 min left');
  });
});
