// Owner: P. WebAble's short notes ("Text is as large as WebAble makes it"): only the newest, for five seconds, with
// no buttons. Undo lives in the sheet. Notes already on screen when a newer one arrives are never shown.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { EngineApi, Toast } from '../../contracts';

export const NOTE_MS = 5000;

/** The note to show now, or null. Each toast is shown at most once, then cleared from the engine. */
export function useNote(api: EngineApi, toasts: Toast[], ms = NOTE_MS): Toast | null {
  const [shown, setShown] = useState<Toast | null>(null);
  const seen = useRef(new Set<string>());
  const last = toasts.length > 0 ? toasts[toasts.length - 1]! : null;
  const lastId = last?.id ?? null;
  useEffect(() => {
    if (!last || seen.current.has(last.id)) return;
    const batch = toasts.map((t) => t.id);
    for (const id of batch) seen.current.add(id);
    setShown(last);
    const timer = window.setTimeout(() => {
      setShown((cur) => (cur && cur.id === last.id ? null : cur));
      for (const id of batch) {
        try {
          api.dismissToast(id);
        } catch {
          /* already gone */
        }
      }
    }, ms);
    return () => window.clearTimeout(timer);
    // A new toast id is the only thing that starts a note.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastId]);
  return shown;
}

/** The note above the WebAble button while the sheet is closed. */
export function Note({ text }: { text: string }) {
  return (
    <div class="wa-note" data-wa-chrome="">
      <i aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}
