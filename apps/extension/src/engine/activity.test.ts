import { describe, expect, it } from 'vitest';
import { createActivity } from './activity';

describe('launcher activity', () => {
  it('stays active until overlapping work finishes, including a rejected request', async () => {
    const counts: number[] = [];
    const activity = createActivity((n) => counts.push(n));
    let finish!: () => void;
    let fail!: (e: Error) => void;
    const a = activity.run(() => new Promise<void>((resolve) => { finish = resolve; }));
    const b = activity.run(() => new Promise<void>((_resolve, reject) => { fail = reject; }));
    const rejected = expect(b).rejects.toThrow('unavailable');
    expect(counts).toEqual([1, 2]);
    finish();
    await a;
    expect(counts.at(-1)).toBe(1);
    fail(new Error('unavailable'));
    await rejected;
    expect(counts).toEqual([1, 2, 1, 0]);
  });

  it('clears synchronous failures and excludes background settings reads', async () => {
    const counts: number[] = [];
    const activity = createActivity((n) => counts.push(n));
    await expect(activity.run(() => { throw new Error('failed'); })).rejects.toThrow('failed');
    expect(counts).toEqual([1, 0]);
    expect(activity.isContentRequest({ type: 'getSettings' })).toBe(false);
    expect(activity.isContentRequest({ type: 'compose', req: { page: {} as never, groups: [] } })).toBe(true);
  });
});
