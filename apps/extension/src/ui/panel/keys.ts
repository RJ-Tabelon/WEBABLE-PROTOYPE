// Owner: P. Keyboard: Alt+W opens and closes the WebAble sheet (Alt+Shift+W too). Quieter extras for demos:
// Alt+Shift+L how WebAble read the page, Alt+Shift+C the simplified page, Alt+Shift+O the original page,
// Alt+Shift+[ and ] page width; Alt+J is an older alias. They never fire while focus is in a text field. Keys are matched by `code` (the physical key), so the
// brackets work whatever character Option+Shift types on a Mac.

export type ShortcutAction = 'lens' | 'calm' | 'original' | 'panel' | 'narrower' | 'wider';

type KeyLike = Pick<KeyboardEvent, 'altKey' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'code'>;

export function shortcutFor(e: KeyLike): ShortcutAction | null {
  if (!e.altKey || e.ctrlKey || e.metaKey) return null;
  if (!e.shiftKey) return e.code === 'KeyW' ? 'panel' : e.code === 'KeyJ' ? 'lens' : null;
  switch (e.code) {
    case 'KeyL':
      return 'lens';
    case 'KeyC':
      return 'calm';
    case 'KeyO':
      return 'original';
    case 'KeyW':
      return 'panel';
    case 'BracketLeft':
      return 'narrower';
    case 'BracketRight':
      return 'wider';
    default:
      return null;
  }
}

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** True when the key event comes from a place where letters are typed (never take those keys). */
export function inEditable(e: Event): boolean {
  const t = (e.composedPath?.()[0] ?? e.target) as Element | null;
  if (!t || typeof (t as Element).getAttribute !== 'function') return false;
  const tag = t.tagName?.toLowerCase();
  if (tag === 'input') return !NON_TEXT_INPUTS.has(((t as HTMLInputElement).type || 'text').toLowerCase());
  if (tag === 'textarea' || tag === 'select') return true;
  if ((t as HTMLElement).isContentEditable) return true;
  const role = t.getAttribute('role');
  return role === 'textbox' || role === 'searchbox' || role === 'combobox';
}
