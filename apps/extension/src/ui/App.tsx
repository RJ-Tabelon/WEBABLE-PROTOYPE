// Owner: P, U, F. The in-page chrome: the WebAble button and its sheet, a short note, one pop-up card, the cookie
// bar, the Jev view, and the simplified page's host.
//
// Steady size: every layer keeps its physical size whatever the page zoom; only the fit's UI scale sizes it.
// - The chrome layer (button, sheet, note, pop-up card, cookie bar, loading screen) is one root with CSS
//   `zoom: scale ÷ page zoom`: inside it one CSS px is one design pixel and the viewport measures as at 100%.
// - The Calm view host gets `zoom: 1 ÷ page zoom`, so the view renders at the fit's sizes exactly.
// - The Lens follows page coordinates, so it stays unzoomed and sizes with --u (scale ÷ zoom).
// One corner dock holds the button and whatever stacks above it (the sheet, or one small card), so nothing overlaps.
import { createPortal } from 'preact/compat';
import { Logo } from './Logo';
import type { ComponentChildren } from 'preact';
import { useEffect, useErrorBoundary, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { EngineApi, EngineState } from '../contracts';
import { CalmView } from './calm/CalmView';
import { Lens } from './lens/Lens';
import { Note, useNote } from './offers/Note';
import { ConsentBar, OverlayOffer, overlayView, type OverlayView } from './offers/Overlays';
import { WaButton } from './panel/Button';
import { pageOrigin } from './panel/format';
import { inEditable, shortcutFor } from './panel/keys';
import { clampBottom, dockHeights, planDock } from './panel/dock';
import { chromeSizing, useEngineState, useReducedMotion } from './panel/hooks';
import { Sheet } from './panel/Sheet';
import { themeModeFor } from './tokens';
import { usePageZoom, useViewport } from './zoom';

export interface AppProps {
  api: EngineApi;
  isOurUi: (t: EventTarget | null) => boolean;
  /** Full-screen element in our shadow root that holds the Calm view. */
  calmHost: HTMLElement;
  /** Render target inside the Calm host's own shadow root (the Calm view's styles live there). */
  calmMount: HTMLElement;
}

/**
 * Keeps one part's failure from taking the rest of the chrome with it: if the simplified page or the Jev view throws
 * while rendering, the button and the sheet stay. `resetKey` tries again when the part's input changes.
 */
function Guard({ name, resetKey, fallback, children }: { name: string; resetKey: string; fallback: ComponentChildren; children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary((e: unknown) => console.warn(`[WebAble] ${name} could not be drawn`, e));
  const key = useRef(resetKey);
  useEffect(() => {
    if (key.current !== resetKey) {
      key.current = resetKey;
      if (error) reset();
    }
  }, [resetKey, error, reset]);
  return <>{error ? fallback : children}</>;
}

function CalmFallback({ api, s, broken = false }: { api: EngineApi; s: EngineState; broken?: boolean }) {
  const failed = broken || (!s.calm.loading && !s.calm.spec);
  return (
    <div class="wa-calm-loading" role="dialog" aria-modal="true" aria-label="Simplified page">
      <div class="wa-calm-loading-card">
        {!failed && <Logo size={48} active />}
        <h2>{failed ? 'This page could not be simplified' : 'Simplifying this page'}</h2>
        <p>
          {failed
            ? 'The page stays as it is. Your other changes are still on.'
            : 'Same page, fewer distractions. Every button still works.'}
        </p>
        <button class="wa-kbtn" onClick={() => api.closeCalm()}>
          {failed ? 'Close' : 'Show the original'}
        </button>
      </div>
    </div>
  );
}

export function App({ api, calmHost, calmMount }: AppProps) {
  const s = useEngineState(api);
  const origin = pageOrigin();
  const pageZoom = usePageZoom(api);
  const vp = useViewport();
  const reduce = useReducedMotion(s.fit);
  const sz = chromeSizing(s.fit, pageZoom);
  const mode = themeModeFor(s.fit);
  const note = useNote(api, s.toasts);

  const rootRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const mainColRef = useRef<HTMLDivElement>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [gone, setGone] = useState<ReadonlySet<string>>(new Set());
  const [barH, setBarH] = useState(0);
  const [dockBox, setDockBox] = useState<{ top: number; w: number } | null>(null);
  const announced = useRef(new Set<string>());

  const calmOpen = s.calm.open;
  // The chrome layer's units: design pixels. Z converts them to the page's CSS px (and back).
  const Z = sz.zoom;
  const vw = vp.w / Z;
  const vh = vp.h / Z;
  const M = 20;
  const GAP = 12;
  // The button: 52 design px, or the person's own minimum target when that is larger.
  const fab = Math.max(52, sz.target);

  // Overlays the engine moved out of the way: a docked cookie notice becomes a bar; tucked ones are listed in the
  // sheet ("Moved a survey out of the way" · Show it); a pop-up WebAble may close is asked about once, in one card.
  const views: OverlayView[] = (s.overlays ?? []).map(overlayView).filter((v) => !gone.has(v.id) && !v.revealed);
  const onPage = !calmOpen && !s.showingOriginal;
  const docked = onPage ? (views.find((v) => v.kind === 'consent' && v.action === 'docked') ?? null) : null;
  const overlayOffer = onPage ? (views.find((v) => v.action === 'offered') ?? null) : null;
  // With the sheet open, the note shows inside it instead.
  const noteText = note?.text ?? null;
  const hasItems = Boolean(overlayOffer || (noteText && !panelOpen));
  // Reserve room for cards above the simplified page's action bar; the launcher itself stays in its corner.
  const [calmDockH, setCalmDockH] = useState(0);

  const barMinH = Math.max(72, sz.target + 20);
  const plan = planDock({
    vw,
    vh,
    margin: M,
    gap: GAP,
    pillW: fab,
    pillH: fab,
    hasItems,
    itemsW: Math.min(360, vw - 2 * M),
    panelOpen,
    panelW: Math.min(360, vw - 2 * M),
    barH: docked ? Math.max(barH, barMinH) : null,
    barMaxW: 1080,
  });

  // One predictable home at every zoom and viewport size, even when site controls occupy this corner.
  const side = 'right';
  const bottom = clampBottom(vh, M, M, fab);
  const contentLift = Math.max(0, plan.minBottom - bottom, calmOpen && calmDockH > 0 ? calmDockH / Z + GAP - bottom : 0);
  const heights = dockHeights(vh, bottom + contentLift, M, fab, GAP, panelOpen);
  const showPill = heights.pillWithPanel;
  // One thing at a time: with the sheet open, the pop-up card waits.
  const showItems = hasItems && !panelOpen;
  const itemsMax = heights.aboveMax;

  // Keyboard: never inside text fields, never synthetic events, and the page still receives every key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.isTrusted || e.repeat) return;
      const act = shortcutFor(e);
      if (!act || inEditable(e)) return;
      const st = api.getState();
      if (act === 'lens') api.toggleLens(!st.lens.on);
      else if (act === 'calm') {
        if (st.calm.open) api.closeCalm();
        else void api.openCalm().catch(() => {});
      } else if (act === 'original') api.showOriginal(!st.showingOriginal);
      else if (act === 'narrower' || act === 'wider') {
        if (st.calm.open || st.showingOriginal) return;
        api.adjustColumn(act === 'narrower' ? -1 : 1);
      } else {
        setPanelOpen((open) => {
          if (open) {
            requestAnimationFrame(() => {
              const root = rootRef.current?.getRootNode();
              if (root instanceof ShadowRoot && root.activeElement) {
                rootRef.current?.querySelector<HTMLButtonElement>('.wa-fab')?.focus({ preventScroll: true });
              }
            });
          }
          return !open;
        });
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [api]);

  // Calm view host: the Calm view renders into its own shadow root; we only show, focus, size and close it.
  // It is zoomed by 1 ÷ page zoom, so it renders at the fit's own sizes (its tokens are computed at zoom 1), and it
  // gets the viewport in its own units for the few lengths that would otherwise use vw / vh.
  const calmReady = Boolean(s.calm.open && s.calm.spec && s.outline && s.fit);
  const wasCalm = useRef(false);
  useLayoutEffect(() => {
    calmHost.classList.toggle('is-open', calmReady);
    calmHost.setAttribute('data-mode', mode);
    calmHost.setAttribute('data-motion', reduce ? 'reduce' : 'full');
    const has = calmReady && calmMount.childElementCount > 0;
    calmHost.classList.toggle('has-content', has);
    const cz = String(Math.round((1 / pageZoom) * 10000) / 10000);
    if (calmHost.style.getPropertyValue('zoom') !== cz) calmHost.style.setProperty('zoom', cz);
    calmHost.style.setProperty('--wa-vw', `${Math.round(vp.w * pageZoom)}px`);
    calmHost.style.setProperty('--wa-vh', `${Math.round(vp.h * pageZoom)}px`);
    // The simplified page's own action bar (its height from the bottom of the screen, in the page's CSS px).
    const calmDock = calmReady ? calmMount.querySelector<HTMLElement>('.wa-dock') : null;
    const dr = calmDock?.getBoundingClientRect();
    const dockH = dr && dr.height > 0 ? Math.max(0, Math.round(vp.h - dr.top)) : 0;
    if (Math.abs(dockH - calmDockH) > 1) setCalmDockH(dockH);
    // With the sheet open (Simplified pressed there), focus stays in the sheet.
    if (calmReady && !wasCalm.current && !panelOpen) {
      const root = calmMount.getRootNode() as ShadowRoot | Document;
      const focused = 'activeElement' in root ? root.activeElement : null;
      if (!focused) calmHost.focus({ preventScroll: true });
    }
    wasCalm.current = calmReady;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && api.getState().calm.open) {
        e.stopPropagation();
        api.closeCalm();
      }
    };
    calmHost.addEventListener('keydown', onKey);
    return () => calmHost.removeEventListener('keydown', onKey);
  }, [api, calmHost]);

  // The Jev view needs the whole page: the sheet steps aside. (The simplified page keeps the sheet open, so the
  // person sees Simplified selected.)
  useEffect(() => {
    if (s.lens.on) setPanelOpen(false);
  }, [s.lens.on]);

  // Overlays brought back stay hidden here until the engine forgets them.
  useEffect(() => {
    if (gone.size === 0) return;
    const kept = new Set(['docked', 'tucked', 'offered', 'minimised', 'unpinned']);
    const ids = new Set((s.overlays ?? []).filter((o) => kept.has(o.action)).map((o) => o.id));
    const keep = [...gone].filter((id) => ids.has(id));
    if (keep.length !== gone.size) setGone(new Set(keep));
  }, [s.overlays, gone]);
  const markGone = (id: string) => setGone((g) => new Set([...g, id]));

  // Announce a docked cookie notice, a pop-up card and each note once, politely.
  const dockedId = docked?.id ?? null;
  const offerId = overlayOffer?.id ?? null;
  useEffect(() => {
    if (offerId) {
      const k = `p:${offerId}`;
      if (!announced.current.has(k)) {
        announced.current.add(k);
        setAnnounce('A pop-up is covering this page. WebAble can close it, next to the WebAble button.');
        return;
      }
    }
    if (dockedId) {
      const k = `c:${dockedId}`;
      if (!announced.current.has(k)) {
        announced.current.add(k);
        setAnnounce("This site asks about cookies. Its choices are in a bar at the bottom of the screen.");
        return;
      }
    }
    if (note) {
      const k = `t:${note.id}`;
      if (!announced.current.has(k)) {
        announced.current.add(k);
        setAnnounce(note.text);
      }
    }
  }, [offerId, note, dockedId]);

  // Measure the dock's box in the page's CSS px (the Jev view keeps clear of it). The items
  // column scrolls only when it truly does not fit (a scroller would clip the cards' shadows).
  useLayoutEffect(() => {
    const d = dockRef.current?.getBoundingClientRect();
    const next = d && d.width > 0 ? { top: Math.round(d.top), w: Math.round(d.width) } : null;
    if ((next?.top ?? -1) !== (dockBox?.top ?? -1) || (next?.w ?? -1) !== (dockBox?.w ?? -1)) setDockBox(next);
    // Natural heights (offsetHeight ignores the entry animation's transform, which scrollHeight would count).
    const el = itemsRef.current;
    if (el) {
      const kids = Array.from(el.children) as HTMLElement[];
      const need = kids.reduce((a, c) => a + c.offsetHeight, 0) + GAP * Math.max(0, kids.length - 1);
      const scroll = need > itemsMax + 1;
      if (scroll !== el.hasAttribute('data-scroll')) {
        if (scroll) {
          el.setAttribute('data-scroll', 'true');
          // Start at the bottom, next to the button.
          el.scrollTop = el.scrollHeight;
        } else el.removeAttribute('data-scroll');
      }
    }
  });

  const closePanel = () => {
    setPanelOpen(false);
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLButtonElement>('.wa-fab')?.focus({ preventScroll: true }));
  };

  // The page layer (the Lens) keeps clear of the dock, in the page's CSS px.
  const dockReserve = dockBox ? Math.max(0, Math.round(vp.h - dockBox.top)) : Math.round((bottom + fab) * Z);

  const r2 = (n: number) => `${Math.round(n * 100) / 100}px`;
  const uiVars = {
    zoom: String(Math.round(Z * 10000) / 10000),
    '--u': '1px',
    '--wa-target': r2(sz.target),
    '--wa-vw': r2(vw),
    '--wa-vh': r2(vh),
  };
  const pageVars = { '--u': `${sz.u}px`, '--wa-target': `${Math.round(sz.targetPx)}px` };
  const edge = `${M}px`;
  const items = showItems ? (
    <div class="wa-dock-items" ref={itemsRef} data-wa-chrome="" style={{ maxHeight: r2(Math.max(0, itemsMax)) }}>
      {noteText && !panelOpen && <Note text={noteText} />}
      {overlayOffer && <OverlayOffer api={api} view={overlayOffer} onGone={markGone} />}
    </div>
  ) : null;

  return (
    <>
      <div
        class="wa-root"
        data-layer="page"
        data-mode={mode}
        data-motion={reduce ? 'reduce' : 'full'}
        data-calm={calmOpen ? 'open' : 'closed'}
        data-calm-open={calmOpen ? '' : undefined}
        style={pageVars}
      >
        {s.lens.on && !calmOpen && (
          <Guard name="Jev view" resetKey={`${s.lens.on}|${s.understanding ? 1 : 0}`} fallback={null}>
            <Lens api={api} s={s} reduce={reduce} bottomReserve={dockReserve} />
          </Guard>
        )}

        {calmReady && s.calm.spec && s.outline && s.fit && (
          <Guard name="Simplified page" resetKey={`${s.calm.source}|${s.calm.spec ? 1 : 0}|${s.calm.open}`} fallback={<CalmFallback api={api} s={s} broken />}>
            {createPortal(<CalmView api={api} spec={s.calm.spec} outline={s.outline} fit={s.fit} />, calmMount)}
          </Guard>
        )}
      </div>

      <div
        class="wa-root"
        data-layer="ui"
        ref={rootRef}
        data-mode={mode}
        data-motion={reduce ? 'reduce' : 'full'}
        data-calm={calmOpen ? 'open' : 'closed'}
        data-calm-open={calmOpen ? '' : undefined}
        style={uiVars}
      >
        {s.calm.open && !calmReady && <CalmFallback api={api} s={s} />}

        {docked && (
          <ConsentBar
            api={api}
            view={docked}
            left={M}
            right={M + fab + GAP}
            bottom={M}
            onGone={markGone}
            layoutKey={String(Math.round(vw))}
            onHeight={setBarH}
          />
        )}

        {(showPill || panelOpen || items) && (
          <div
            class="wa-dock"
            ref={dockRef}
            data-side={side}
            style={{ bottom: r2(bottom), right: edge, left: 'auto', maxHeight: r2(Math.max(0, vh - bottom - M)) }}
          >
            <div class="wa-dock-col" ref={mainColRef} style={{ maxHeight: r2(Math.max(0, vh - bottom - M)) }}>
              {(panelOpen || items) && (
                <div class="wa-dock-content" style={{ maxHeight: r2(heights.aboveMax), marginBottom: r2(contentLift) }}>
                  {!panelOpen && items}
                  {panelOpen && (
                    <Sheet
                      api={api}
                      s={s}
                      origin={origin}
                      side={side}
                      maxHeightPx={heights.aboveMax}
                      pageZoom={pageZoom}
                      gone={gone}
                      onGone={markGone}
                      note={noteText}
                      onClose={closePanel}
                    />
                  )}
                </div>
              )}
              {showPill && <WaButton s={s} origin={origin} open={panelOpen} onToggle={() => (panelOpen ? closePanel() : setPanelOpen(true))} />}
            </div>
          </div>
        )}

        <div class="wa-sr" aria-live="polite" role="status">
          {announce}
        </div>
      </div>
    </>
  );
}
