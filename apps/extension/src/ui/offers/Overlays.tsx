// Owner: P. In-page UI for overlays the engine moved out of the way (EngineState.overlays):
// - a docked cookie notice becomes a short bar: "This site asks about cookies.", the site's own choices in one
//   neutral style, and "Read the notice". WebAble never answers it: pressing a choice brings the notice back
//   first, then presses the site's own control;
// - a tucked survey, sign-up box or chat is listed in the sheet ("Moved a survey out of the way" · Show it);
// - a pop-up the engine only offers to close becomes one small card ("Close it" / "Leave it").
// Commands go through api.restoreOverlay: `id` (Show it), `${id}#read` (back for this page view only),
// `${id}#close` (accept the offered close).
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { OverlayAction, OverlayKind } from '@webable/core';
import type { EngineApi } from '../../contracts';
import { IconChevron, IconShield } from '../panel/icons';
import { popupNoun } from '../panel/model';

/** One of the site's own buttons in a docked notice, in DOM order (`id` works with api.elementFor). */
export interface OverlayChoice {
  id: string | null;
  label: string;
}

/** What the UI reads from one overlay action. The extra fields are optional on the wire and read defensively. */
export interface OverlayView {
  id: string;
  kind: OverlayKind;
  action: OverlayAction['action'];
  name: string;
  choices: OverlayChoice[];
  /** The person moved focus into it, so it is back on screen: hide its bar or chip. */
  revealed: boolean;
  edge: 'top' | 'bottom' | 'left' | 'right' | null;
  question: string | null;
}

const KIND_NAME: Record<OverlayKind, string> = {
  consent: 'Cookie notice',
  chat: 'Chat',
  survey: 'Survey',
  newsletter: 'Signup',
  promo_bar: 'Offer',
  warning: 'Notice',
  modal: 'Popup',
  header: 'Header',
  other: 'Popup',
};

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.replace(/\s+/g, ' ').trim() : null;
}

function choicesFrom(v: unknown): OverlayChoice[] {
  if (!Array.isArray(v)) return [];
  const out: OverlayChoice[] = [];
  for (const x of v) {
    if (typeof x === 'string') {
      const label = str(x);
      if (label) out.push({ id: null, label });
    } else if (x && typeof x === 'object') {
      const o = x as Record<string, unknown>;
      const label = str(o.label) ?? str(o.name) ?? str(o.text);
      if (label) out.push({ id: str(o.id), label });
    }
  }
  return out.slice(0, 6);
}

const EDGES = new Set(['top', 'bottom', 'left', 'right']);

/** Read one overlay action plus the fields the engine attaches (name, choices, revealed, edge, question). */
export function overlayView(o: OverlayAction): OverlayView {
  const x = o as OverlayAction & Record<string, unknown>;
  const name = str(x.name);
  const edge = typeof x.edge === 'string' && EDGES.has(x.edge) ? (x.edge as OverlayView['edge']) : null;
  return {
    id: o.id,
    kind: o.kind,
    action: o.action,
    name: name && name.length <= 28 ? name : KIND_NAME[o.kind] ?? 'Popup',
    choices: choicesFrom(x.choices),
    revealed: x.revealed === true,
    edge,
    question: str(x.question),
  };
}

const CONTROL = 'button, a[href], [role="button"], input[type="button"], input[type="submit"]';

function textOf(el: Element): string {
  const t = (el as HTMLElement).innerText || el.textContent || el.getAttribute('aria-label') || (el as HTMLInputElement).value || '';
  return t.replace(/\s+/g, ' ').trim().toLowerCase();
}

/** The site's own control for a choice: by the engine's id, else by its label inside the notice. */
function findControl(api: EngineApi, overlayId: string, c: OverlayChoice): HTMLElement | null {
  if (c.id) {
    const el = api.elementFor(c.id);
    if (el instanceof HTMLElement && el.isConnected) return el;
  }
  const root = api.elementFor(overlayId);
  if (!root) return null;
  const want = c.label.toLowerCase();
  let partial: HTMLElement | null = null;
  for (const el of Array.from(root.querySelectorAll(CONTROL))) {
    const t = textOf(el);
    if (!t) continue;
    if (t === want) return el as HTMLElement;
    if (!partial && (t.startsWith(want) || want.startsWith(t))) partial = el as HTMLElement;
  }
  return partial;
}

function afterPaint(fn: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(fn));
}

interface BarProps {
  api: EngineApi;
  view: OverlayView;
  /** Insets from the viewport edges, in the layer's CSS px. */
  left: number;
  right: number;
  bottom: number;
  onGone: (id: string) => void;
  /** Changes when the room for the bar changes (viewport width): measure the row again. */
  layoutKey?: string;
  /** Reports the bar's height (layer CSS px) so the corner dock can sit above it. */
  onHeight?: (px: number) => void;
}

/** The short bar a docked cookie notice becomes. It never answers for the person. */
export function ConsentBar({ api, view, left, right, bottom, onGone, layoutKey = '', onHeight }: BarProps) {
  const barRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const lastH = useRef(0);
  const key = `${view.id}|${view.choices.map((c) => c.label).join('|')}|${Math.round(left)}|${Math.round(right)}|${layoutKey}`;

  // One row only: if the site's choices do not fit beside the sentence, show "Show the choices" instead. The sentence
  // never shrinks under the buttons, so a row that does not fit always overflows and is caught here.
  useLayoutEffect(() => {
    setCompact(false);
  }, [key]);
  useLayoutEffect(() => {
    const row = rowRef.current;
    if (row && !compact && row.scrollWidth > row.clientWidth + 1) setCompact(true);
    const h = barRef.current?.offsetHeight ?? 0;
    if (h > 0 && Math.abs(h - lastH.current) > 0.5) {
      lastH.current = h;
      onHeight?.(h);
    }
  });

  const bringBack = () => {
    api.restoreOverlay(`${view.id}#read`);
    onGone(view.id);
  };
  const press = (c: OverlayChoice) => {
    // The notice comes back first, so the site's own control is on screen when it is pressed.
    api.restoreOverlay(`${view.id}#read`);
    onGone(view.id);
    afterPaint(() => findControl(api, view.id, c)?.click());
  };

  const showChoices = compact || view.choices.length === 0;
  return (
    <div
      class="wa-cbar"
      ref={barRef}
      role="region"
      aria-label="Cookie notice from this site"
      data-compact={showChoices ? '' : undefined}
      data-wa-chrome=""
      style={{ left: `${Math.round(left)}px`, right: `${Math.round(right)}px`, bottom: `${Math.round(bottom)}px` }}
    >
      <div class="wa-cbar-row" ref={rowRef}>
        <span class="wa-cbar-icon" aria-hidden="true">
          <IconShield size={18} />
        </span>
        <p class="wa-cbar-text">This site asks about cookies.</p>
        {!showChoices && <span class="wa-cbar-gap" aria-hidden="true" />}
        {showChoices ? (
          <button class="wa-kbtn wa-cbar-btn" onClick={bringBack}>
            Show the choices
          </button>
        ) : (
          <>
            <div class="wa-cbar-choices" role="group" aria-label="The site's own choices">
              {view.choices.map((c, i) => (
                <button key={`${i}-${c.label}`} class="wa-kbtn wa-cbar-btn" onClick={() => press(c)}>
                  {c.label}
                </button>
              ))}
            </div>
            <button class="wa-cbar-read" onClick={bringBack}>
              Read the notice
              <IconChevron size={14} />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/** A modal the engine found a safe close button for: offered, never pressed without the person. */
export function OverlayOffer({ api, view, onGone }: { api: EngineApi; view: OverlayView; onGone: (id: string) => void }) {
  const noun = popupNoun(view.kind);
  const what = noun.charAt(0).toUpperCase() + noun.slice(1);
  return (
    <div class="wa-offer" role="region" aria-label="WebAble" data-wa-chrome="">
      <p class="wa-offer-q">{what} is covering this page.</p>
      <p class="wa-offer-fact">WebAble can close it with the site's own close button.</p>
      <div class="wa-offer-btns">
        <button
          class="wa-kbtn"
          onClick={() => {
            api.restoreOverlay(view.id);
            onGone(view.id);
          }}
        >
          Leave it
        </button>
        <button
          class="wa-kbtn wa-kbtn-primary"
          onClick={() => {
            api.restoreOverlay(`${view.id}#close`);
            onGone(view.id);
          }}
        >
          Close it
        </button>
      </div>
    </div>
  );
}
