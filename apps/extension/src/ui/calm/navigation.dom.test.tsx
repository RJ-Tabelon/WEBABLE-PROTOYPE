// @vitest-environment happy-dom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PrimaryAction } from './Blocks';
import { Calm, type CalmCtx } from './context';
import { controlFor, newCtx } from './model';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('primary navigation in Calm view', () => {
  it('preserves a real destination and browser modifier clicks when a link moves to the dock', () => {
    const original = document.createElement('a');
    original.href = 'https://example.com/next';
    original.textContent = 'Read the next article';
    original.target = '_blank';
    document.body.append(original);
    const pressPrimary = vi.fn();
    const ctx = { pressPrimary } as unknown as CalmCtx;
    const host = document.body.appendChild(document.createElement('div'));
    act(() =>
      render(
        <Calm.Provider value={ctx}>
          <PrimaryAction b={controlFor(original, newCtx())!} />
        </Calm.Provider>,
        host,
      ),
    );
    const link = host.querySelector('a')!;
    expect(link.href).toBe(original.href);
    expect(link.target).toBe('_blank');
    const modified = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    act(() => {
      link.dispatchEvent(modified);
    });
    expect(modified.defaultPrevented).toBe(false);
    expect(pressPrimary).not.toHaveBeenCalled();
    const normal = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => {
      link.dispatchEvent(normal);
    });
    expect(normal.defaultPrevented).toBe(true);
    expect(pressPrimary).toHaveBeenCalledWith(original);
    act(() => render(null, host));
  });
});
