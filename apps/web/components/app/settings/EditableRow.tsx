'use client';

import { Button } from '@webable/ui';
import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

export interface EditableRowProps {
  /** Row label (16 / medium), for example "Email". */
  label: string;
  /** The value at rest ("alex@example.com", "Set", "Not set"). */
  value: ReactNode;
  /** The ghost action that opens the editor: "Change", "Add a password". */
  action: string;
  /** Words after the action for screen readers ("email", "password"). */
  actionContext?: string;
  /** A quiet line under the value after a change ("Link sent to …"). */
  note?: ReactNode;
  /**
   * The editor, given a `close` that collapses the row and returns focus to
   * the action. Rendered only while open.
   */
  children: (close: () => void) => ReactNode;
}

/**
 * One hairline settings row (design-final §7.9: documents, not dashboards):
 * label · value, and a ghost action at the end that opens the editor in place.
 * The action is a disclosure (aria-expanded); Esc or Cancel closes the editor,
 * and focus goes back to the action.
 */
export function EditableRow({
  label,
  value,
  action,
  actionContext,
  note,
  children,
}: EditableRowProps) {
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const editorRef = useRef<HTMLDivElement>(null);
  const editorId = useId();
  const labelId = useId();

  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => toggleRef.current?.focus());
  }, []);

  // Opening moves focus to the first field.
  useEffect(() => {
    if (!open) return;
    const first = editorRef.current?.querySelector<HTMLElement>(
      'input:not([type="hidden"]):not([type="checkbox"])',
    );
    (first ?? editorRef.current)?.focus();
  }, [open]);

  return (
    <li className="wa-row wa-row--split wa-row--end-action wa-setting-row">
      <div className="wa-setting-row__text">
        <p id={labelId} className="wa-row__label wa-setting-row__label">
          {label}
        </p>
        <p className="wa-setting-row__value">{value}</p>
        {note ? <div className="wa-setting-row__note">{note}</div> : null}
      </div>
      <div className="wa-row__actions">
        <Button
          ref={toggleRef}
          variant="ghost"
          size="md"
          flush="end"
          aria-expanded={open}
          aria-controls={open ? editorId : undefined}
          onClick={() => (open ? close() : setOpen(true))}
        >
          {action}
          {actionContext ? (
            <span className="sr-only"> {actionContext}</span>
          ) : null}
        </Button>
      </div>
      {open ? (
        <div
          id={editorId}
          ref={editorRef}
          role="group"
          aria-labelledby={labelId}
          tabIndex={-1}
          className="wa-setting-row__editor"
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        >
          {children(close)}
        </div>
      ) : null}
    </li>
  );
}
