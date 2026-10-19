import { describe, expect, it } from 'vitest';

import { messageText } from './status';

describe('messageText', () => {
  it('drops the action labels from the message', () => {
    expect(messageText('Conversation archived. Undo', ['Undo'])).toBe(
      'Conversation archived.',
    );
    expect(messageText('Added to cart · View cart', ['View cart'])).toBe(
      'Added to cart',
    );
  });

  it('removes one occurrence per action and keeps the rest of the text', () => {
    expect(messageText('Undo sending? Undo', ['Undo'])).toBe('Undo sending?');
    expect(messageText('Saved', [])).toBe('Saved');
  });
});
