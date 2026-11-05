// Owner: P. The WebAble sheet, above the button. Six things, top to bottom:
// 1. "WebAble" and the site, with Close;
// 2. Simplified | Original, only where the simplified page is in use;
// 3. Text size − / + with an "Aa" at the shown size and its word level between them (never px);
// 4. What WebAble did here: plain lines, each with Undo (or "Show it" for a pop-up moved aside);
// 5. Pause on this site;
// 6. How WebAble read this page · Your settings.
import { useEffect, useRef, useState } from 'preact/hooks';
import type { JSX } from 'preact';
import type { EngineApi, EngineState } from '../../contracts';
import { Logo } from '../Logo';
import { openSettings, setPaused } from './actions';
import type { PillSide } from './hooks';
import {
  IconClose,
  IconBook,
  IconContrast,
  IconFade,
  IconFocus,
  IconHand,
  IconLines,
  IconMinus,
  IconPause,
  IconPin,
  IconPlus,
  IconStar,
  IconTarget,
  IconTextSize,
  IconWindow,
} from './icons';
import {
  didLines,
  pageUnread,
  rewordLine,
  sheetMode,
  showViewSwitch,
  shownTextPx,
  siteName,
  sizeWord,
  UNREAD,
  type DidIcon,
  type DidLine,
  type RewordLine,
} from './model';

const ICONS: Record<DidIcon, (p: { size?: number }) => JSX.Element> = {
  text: IconTextSize,
  contrast: IconContrast,
  target: IconTarget,
  fade: IconFade,
  pause: IconPause,
  popup: IconWindow,
  steady: IconHand,
  bar: IconPin,
  lines: IconLines,
  star: IconStar,
  focus: IconFocus,
};

/** The page's own paragraph size in CSS px (the first real paragraph in view order), or null. */
export function measurePageTextPx(): number | null {
  try {
    const list = document.querySelectorAll('main p, article p, [role="main"] p, p');
    const n = Math.min(list.length, 120);
    for (let i = 0; i < n; i++) {
      const el = list[i] as HTMLElement;
      if ((el.textContent ?? '').trim().length < 60) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 160 || r.height <= 0) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px > 0) return px;
    }
    const b = parseFloat(getComputedStyle(document.body).fontSize);
    return b > 0 ? b : null;
  } catch {
    return null;
  }
}

interface Props {
  api: EngineApi;
  s: EngineState;
  origin: string;
  side: PillSide;
  /** The tallest the sheet may be, in the chrome layer's px. Its middle scrolls when it must. */
  maxHeightPx: number;
  pageZoom: number;
  /** Pop-ups brought back here, hidden until the engine forgets them. */
  gone: ReadonlySet<string>;
  onGone: (id: string) => void;
  /** WebAble's latest short note ("Text is as large as WebAble makes it"), shown under the text size for a moment. */
  note: string | null;
  onClose: () => void;
  onAdjust?: (what: 'text') => void;
}

function DidRow({ line, onAct }: { line: DidLine; onAct: (l: DidLine) => void }) {
  const Icon = ICONS[line.icon];
  const verb = line.action.kind === 'show' ? (line.action.overlayIds.length > 1 ? 'Show them' : 'Show it') : 'Undo';
  return (
    <li class="wa-did">
      <span class="wa-did-ic" aria-hidden="true">
        <Icon size={20} />
      </span>
      <span class="wa-did-t">{line.text}</span>
      <button class="wa-did-act" aria-label={`${verb}: ${line.text}`} onClick={() => onAct(line)}>
        {verb}
      </button>
    </li>
  );
}

/** Round 9: paragraphs rewritten for this person, with one switch back to the page's own words. */
function RewordRow({ line, onOriginal }: { line: RewordLine; onOriginal: (on: boolean) => void }) {
  return (
    <li class="wa-did-rw">
      <div class="wa-did">
        <span class="wa-did-ic" aria-hidden="true">
          <IconBook size={20} />
        </span>
        <span class="wa-did-t" role={line.busy ? 'status' : undefined}>
          {line.text}
        </span>
      </div>
      {!line.busy && (
        <button class="wa-sh-switch wa-did-switch" role="switch" aria-checked={line.showingOriginal} onClick={() => onOriginal(!line.showingOriginal)}>
          <span>Show the page's own words</span>
          <span class="wa-sh-track" aria-hidden="true" />
        </button>
      )}
    </li>
  );
}

export function Sheet({ api, s, origin, side, maxHeightPx, pageZoom, gone, onGone, note, onClose, onAdjust }: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const didRef = useRef<HTMLHeadingElement>(null);
  const mode = sheetMode(s, origin);
  const site = siteName(origin);

  // "Pause on this site" answers at once; the engine's settings catch up a moment later.
  const pausedNow = mode === 'paused';
  const [pauseWant, setPauseWant] = useState<boolean | null>(null);
  const pausedKey = (s.settings.pausedOrigins ?? []).join('|');
  useEffect(() => setPauseWant(null), [pausedKey]);
  const paused = pauseWant ?? pausedNow;

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  const on = mode === 'on' && !paused;
  const lines = on ? didLines(s, gone) : [];
  const rw = on ? rewordLine(s.reword) : null;
  const unread = on && pageUnread(s);
  const viewSwitch = on && showViewSwitch(s.calm);
  const simplified = Boolean(s.calm.open || (s.calm.loading && !s.calm.open));
  const px = on ? shownTextPx(s, pageZoom, s.calm.open ? null : measurePageTextPx()) : null;
  const size = sizeWord(px);
  // The "Aa" is drawn at the size the page shows (one CSS px is one design pixel in the chrome layer), kept in the row.
  const aaPx = px === null ? null : Math.min(34, Math.max(12, Math.round(px)));

  const act = (l: DidLine) => {
    if (l.action.kind === 'undo') for (const id of l.action.opIds) api.undoOp(id);
    else
      for (const id of l.action.overlayIds) {
        api.restoreOverlay(id);
        onGone(id);
      }
    // The row leaves: keep focus in the sheet, on the list's heading.
    requestAnimationFrame(() => didRef.current?.focus({ preventScroll: true }));
  };
  const text = (step: -1 | 1) => {
    onAdjust?.('text');
    api.adjustText(step);
  };
  const togglePause = () => {
    const next = !paused;
    setPauseWant(next);
    void setPaused(s.settings, origin, next);
  };

  return (
    <div
      class="wa-sheet"
      role="dialog"
      aria-label="WebAble"
      data-side={side}
      data-wa-chrome=""
      style={{ maxHeight: `${Math.max(160, Math.round(maxHeightPx))}px` }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header class="wa-sh-head">
        <div class="wa-sh-title">
          <h2 ref={titleRef} tabIndex={-1}>
            <Logo size={24} />
            WebAble
          </h2>
          {site && <p>{site}</p>}
        </div>
        <button class="wa-sh-x" aria-label="Close" onClick={onClose}>
          <IconClose size={18} />
        </button>
      </header>

      <div class="wa-sh-body">
        {viewSwitch && (
          <div class="wa-sh-sec">
            <div class="wa-seg2" role="group" aria-label="How this page is shown">
              <button
                aria-pressed={simplified}
                onClick={() => {
                  if (!simplified) void api.openCalm().catch(() => {});
                }}
              >
                Simplified
              </button>
              <button
                aria-pressed={!simplified}
                onClick={() => {
                  if (simplified) api.closeCalm();
                }}
              >
                Original
              </button>
            </div>
          </div>
        )}

        {on && (
          <div class="wa-sh-sec">
            <div class="wa-sh-size">
              <span class="wa-sh-label" id="wa-size-label">
                Text size
              </span>
              <div class="wa-stepper" role="group" aria-labelledby="wa-size-label">
                <button class="wa-step" aria-label="Smaller text" onClick={() => text(-1)}>
                  <IconMinus size={20} />
                </button>
                <output class="wa-step-val" aria-live="polite">
                  {aaPx !== null && (
                    <span class="wa-step-aa" aria-hidden="true" style={{ fontSize: `${aaPx}px` }}>
                      Aa
                    </span>
                  )}
                  <span class="wa-step-word">{size}</span>
                </output>
                <button class="wa-step" aria-label="Larger text" onClick={() => text(1)}>
                  <IconPlus size={20} />
                </button>
              </div>
            </div>
            {note && (
              <p class="wa-sh-note" role="status">
                {note}
              </p>
            )}
          </div>
        )}

        {on && (
          <section class="wa-sh-sec" aria-labelledby="wa-did-h">
            <h3 class="wa-sh-h" id="wa-did-h" ref={didRef} tabIndex={-1}>
              What WebAble did here
            </h3>
            {unread && <p class="wa-sh-quiet">{UNREAD}</p>}
            {lines.length > 0 || rw ? (
              <ul class="wa-did-list">
                {rw && <RewordRow line={rw} onOriginal={(v) => api.showOriginalWords(v)} />}
                {lines.map((l) => (
                  <DidRow key={l.key} line={l} onAct={act} />
                ))}
              </ul>
            ) : (
              !unread && <p class="wa-sh-quiet">Nothing needed changing here.</p>
            )}
          </section>
        )}

        {mode === 'original' && !paused && (
          <div class="wa-sh-sec">
            <p class="wa-sh-quiet">Showing this page the way the site made it.</p>
            <button class="wa-sh-text" onClick={() => api.showOriginal(false)}>
              Show my changes again
            </button>
          </div>
        )}

        {mode === 'off' && (
          <div class="wa-sh-sec">
            <p class="wa-sh-quiet">WebAble is turned off. Turn it on from the WebAble icon in your browser's toolbar.</p>
          </div>
        )}

        {mode !== 'off' && (
          <div class="wa-sh-sec">
            {paused && <p class="wa-sh-quiet wa-sh-quiet-top">Pages on this site look the way the site made them.</p>}
            <button class="wa-sh-switch" role="switch" aria-checked={paused} onClick={togglePause}>
              <span>Pause on this site</span>
              <span class="wa-sh-track" aria-hidden="true" />
            </button>
          </div>
        )}
      </div>

      <footer class="wa-sh-foot">
        {mode === 'on' && !paused && (
          <button class="wa-sh-link" onClick={() => api.toggleLens(true)}>
            How WebAble read this page
          </button>
        )}
        <button class="wa-sh-link" onClick={() => openSettings(api)}>
          Your settings
        </button>
      </footer>
    </div>
  );
}
