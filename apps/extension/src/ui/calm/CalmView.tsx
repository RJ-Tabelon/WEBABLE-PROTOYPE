// Owner: C, D (round 4: Calm view v3, page kinds). The Calm view: the same page re-presented as one calm column, sized
// to the person's fit, in the research-site language of design.md (white page, no boxed cards, ink pills, hairlines).
//
// Input is a FitSpec (enums and ids only, from the heuristic, a layout Jev picked, or the cached one). Every word shown
// is read from the live page at render time on this device, and every control drives its original element
// (src/ui/proxy.ts), so the page keeps working and nothing is sent anywhere. The original page is one click away.
//
// First screen (1280×720): the strip, then the page's title (top ≤ 140 px), one orientation line in the page's words,
// then the task (first field, first row or the buy button) above the dock. One filled button on screen at most: the
// dock's.
import type { FitProfile, FitSpec, PageOutline } from '@webable/core';
import { Fragment, type JSX } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { EngineApi } from '../../contracts';
import { calmChromeCss } from '../base.css';
import { focusOriginal, proxyClick, proxyKey } from '../proxy';
import { calmMetrics, structureParams, themeModeFor, tokensFor, tokensToStyle } from '../tokens';
import { Blocks } from './Blocks';
import { ChatRow, ErrorCard, NoticeCard, PortalLinks, ProgressCard, SuccessPanel } from './Cards';
import { Disclosure } from './Disclosure';
import { Calm, type CalmCtx, isResultsUrl } from './context';
import { Dock } from './Dock';
import { MoreFrom, SiteLinks } from './End';
import { planGroups } from './grouping';
import * as I from './icons';
import { IndexView } from './Index';
import { ArticleHeader, LeadBand } from './Lead';
import { calmSheetCss, tickNow, useCalmStyles, useDomVersion, useEngineState, useReducedMotion } from './live';
import { pageMarks, readTimeLine } from './markers';
import { pageMeaning } from './meaning';
import { type Block, isShown, keyOf, newCtx, pagePopups, readBlocks, textOf } from './model';
import { useOutcome } from './outcome';
import { type CalmPlan, buildPlan } from './plan';
import { PurposeView } from './Purpose';
import { stepOf } from './sections/FormSteps';
import { HelpCard } from './sections/layouts';
import { Drawer, SectionView } from './sections/Section';
import { type SettleCtl, createSettle } from './settle';
import { Strip, SubStrip } from './Strip';

/** Text size on the simplified page: the panel's steps (state.calm.textStep), 15% each, 0.85× to 1.6×. */
function scaleFor(step: number | undefined): number {
  return Math.round(Math.min(1.6, Math.max(0.85, 1 + 0.15 * (step ?? 0))) * 100) / 100;
}

const specIds = new WeakMap<object, number>();
let specN = 0;
function specKey(s: object): number {
  let k = specIds.get(s);
  if (!k) {
    k = ++specN;
    specIds.set(s, k);
  }
  return k;
}

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/** The site's menus and link bars: one "Site menu" at the end, folded. */
function isMenu(p: CalmPlan['main'][number]): boolean {
  return p.sec.role === 'navigation' && p.state === 'collapsed';
}

/** Hide the WebAble pill and floating chips while the view is open (rules adopted into the chrome's shadow root). */
function useChromeRules(rootRef: { current: HTMLElement | null }): void {
  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const inner = node.getRootNode();
    const host = inner instanceof ShadowRoot ? inner.host : null;
    const outer = host?.getRootNode();
    if (!(outer instanceof ShadowRoot) || !('adoptedStyleSheets' in outer)) return;
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(calmChromeCss);
      outer.adoptedStyleSheets = [...outer.adoptedStyleSheets, sheet];
      return () => {
        outer.adoptedStyleSheets = outer.adoptedStyleSheets.filter((s) => s !== sheet);
      };
    } catch {
      return undefined;
    }
  }, [rootRef]);
}

export function CalmView(props: { api: EngineApi; spec: FitSpec; outline: PageOutline; fit: FitProfile }): JSX.Element {
  const { api, spec, outline, fit } = props;
  const state = useEngineState(api);
  // The Calm host is CSS-zoomed by 1 ÷ page zoom (App), so the view lays out as at 100%: its lengths need no division.
  const zoom = 1;
  const version = useDomVersion();
  const sysReduce = useReducedMotion();
  const rootRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const needInline = useCalmStyles(rootRef);
  useChromeRules(rootRef);
  const scale = scaleFor(state.calm.textStep);
  const [step, setStep] = useState(0);
  const [drawerCall, setDrawerCall] = useState(0);
  const { outcome, arm } = useOutcome();

  const level = (fit?.attention?.structureLevel ?? 0) as 0 | 1 | 2;
  const params = structureParams(level);
  const mode = themeModeFor(fit);
  const reduceMotion = sysReduce || !!fit?.attention?.motion?.on;
  const tokens = useMemo(() => tokensFor(fit, mode, { zoom, density: spec.density, scale, surface: 'calm' }), [fit, mode, zoom, spec.density, scale]);
  const m = calmMetrics(fit, { zoom, density: spec.density, scale, surface: 'calm' });
  const style = useMemo(() => tokensToStyle(tokens), [tokens]);

  // Round 7: what this page is for (Jev's page model v2 and the content read on this device), so the view leads with it.
  const meaning = useMemo(() => {
    try {
      return pageMeaning({ outline, understanding: state.understanding, elementFor: (id) => api.elementFor(id) });
    } catch (e) {
      console.warn('[WebAble] Calm view could not read what this page is for', e);
      return null;
    }
  }, [api, outline, state.understanding]);

  const rwVersion = state.reword?.version ?? 0;
  const plan = useMemo<CalmPlan | null>(() => {
    try {
      return buildPlan({
        spec, outline, elementFor: (id) => api.elementFor(id), decisions: state.decisions ?? [], listFirst: params.listFirst,
        stepMax: params.stepMax, groupSize: params.groupSize, meaning,
      });
    } catch (e) {
      console.warn('[WebAble] Calm view could not read this page', e);
      return null;
    }
    // `version` re-reads the live page after it changes; so does a paragraph rewritten (or switched back) for the person.
  }, [api, spec, outline, state.decisions, version, rwVersion, params.listFirst, params.stepMax, params.groupSize, meaning]);

  // Round 8 markers: Jev's live badges and paid content, and "N min read" on an article that does not say it.
  const marks = useMemo(() => pageMarks(state.understanding, (id) => api.elementFor(id)), [api, state.understanding]);
  const isArticle = plan?.kind === 'article' && !!plan.article;
  const readLine = useMemo(() => {
    if (!isArticle) return null;
    try {
      return readTimeLine(document, state.understanding, (id) => api.elementFor(id));
    } catch {
      return null;
    }
  }, [api, isArticle, state.understanding]);

  // Round 10: the running text of the page's reading parts in groups, asked for once per plan (the engine dedupes);
  // each group settles into its components as they arrive (Grouped.tsx). Never on a page with password or payment
  // fields (those keep the in-place fixes), a form or a results page.
  const noGroups = !!state.digest?.hasSensitiveFields || spec.page_type === 'search_results' || spec.page_type === 'form' || isResultsUrl();
  const grouped = useMemo(() => {
    try {
      return planGroups(noGroups ? null : plan);
    } catch (e) {
      console.warn('[WebAble] Simplified page could not group this page', e);
      return planGroups(null);
    }
  }, [plan, noGroups]);
  useEffect(() => {
    if (!grouped.groups.length || typeof api.compose !== 'function') return;
    try {
      api.compose(grouped.groups);
    } catch (e) {
      console.warn('[WebAble] Simplified page could not ask for the page laid out', e);
    }
  }, [api, grouped]);
  const groupOrder = useMemo(() => grouped.groups.map((g) => g.id), [grouped]);
  const settleRef = useRef<SettleCtl | null>(null);
  if (!settleRef.current) settleRef.current = createSettle(() => rootRef.current);
  const settle = settleRef.current;
  useEffect(() => () => settle.dispose(), [settle]);
  const composeVersion = state.compose?.version ?? 0;

  // A different layout (Jev's pick arrived) starts the form again at its first step.
  useEffect(() => setStep(0), [spec]);
  const nSteps = plan?.form?.steps?.length ?? 0;
  useEffect(() => {
    if (nSteps && step > nSteps - 1) setStep(nSteps - 1);
  }, [nSteps, step]);

  /* ---------- what the page shows after the primary action, and popups the person opened ---------- */

  const [resultRoots, setResultRoots] = useState<Element[]>([]);
  const watch = useRef<MutationObserver | null>(null);
  const [popup, setPopup] = useState<Element | null>(null);

  const watchPopups = useCallback((before: Set<Element>) => {
    const check = (): void => {
      const fresh = pagePopups().filter((p) => !before.has(p));
      if (fresh.length) setPopup(fresh[fresh.length - 1]!);
    };
    window.setTimeout(check, 350);
    window.setTimeout(check, 1200);
  }, []);

  const watchResult = useCallback(() => {
    watch.current?.disconnect();
    setResultRoots([]);
    const found: Element[] = [];
    const mo = new MutationObserver((recs) => {
      for (const r of recs) {
        const nodes = r.type === 'childList' ? Array.from(r.addedNodes) : [r.target];
        for (const n of nodes) {
          const e = n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement;
          if (!e || e.closest('webable-ui') || found.some((f) => f.contains(e))) continue;
          for (let i = found.length - 1; i >= 0; i--) if (e.contains(found[i]!)) found.splice(i, 1);
          found.push(e);
        }
      }
      setResultRoots(found.slice());
    });
    mo.observe(document.body ?? document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['hidden'] });
    watch.current = mo;
    window.setTimeout(() => {
      if (watch.current === mo) {
        mo.disconnect();
        watch.current = null;
      }
    }, 5000);
  }, []);
  useEffect(() => () => watch.current?.disconnect(), []);

  const goStep = useCallback(
    (i: number) => {
      setStep(Math.max(0, Math.min(Math.max(0, nSteps - 1), i)));
    },
    [nSteps],
  );

  /** A link to a field ("Enter your phone number" in the page's error summary) goes to the step that holds it. */
  const jumpToField = useCallback(
    (el: Element): boolean => {
      const href = el.getAttribute('href') ?? '';
      if (!href.startsWith('#') || href.length < 2) return false;
      let target: Element | null = null;
      try {
        target = document.getElementById(decodeURIComponent(href.slice(1)));
      } catch {
        target = null;
      }
      if (!target) return false;
      const steps = plan?.form?.steps;
      const idx = steps ? stepOf(steps, target) : -1;
      if (steps && idx >= 0) setStep(idx);
      const field = target.matches('input,select,textarea') ? target : target.parentElement?.querySelector('input,select,textarea') ?? null;
      window.setTimeout(() => {
        const root = rootRef.current;
        const k = field ? keyOf(field) : '';
        const mirror = (k && root?.querySelector<HTMLElement>(`[data-k="${k}"]`)) || null;
        mirror?.focus();
        mirror?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 120);
      return !!field || idx >= 0;
    },
    [plan],
  );

  const results = spec.page_type === 'search_results' || isResultsUrl();
  const ctx = useMemo<CalmCtx>(
    () => ({
      api,
      splitN: params.splitSentences,
      groupSize: params.groupSize,
      reduceMotion,
      click: (el) => {
        if (el.localName === 'a' && jumpToField(el)) return;
        const before = new Set(pagePopups());
        proxyClick(el);
        tickNow();
        watchPopups(before);
      },
      pressPrimary: (el) => {
        const before = new Set(pagePopups());
        watchResult();
        arm();
        proxyClick(el);
        tickNow();
        watchPopups(before);
      },
      peek: (el) => {
        api.closeCalm('peek');
        window.setTimeout(() => focusOriginal(el), 80);
      },
      step,
      goStep,
      showDrawer: () => setDrawerCall((n) => n + 1),
      drawerCall,
      errorEl: outcome?.kind === 'error' ? outcome.el : null,
      kind: plan?.kind ?? 'page',
      textCol: m.textCol,
      results,
      marks,
      pulse: !reduceMotion,
      compose: state.compose,
      segments: grouped.segments,
      groupOrder,
      settle,
    }),
    // `composeVersion`: a group changed (ready, kept or failed), so the parts that draw it re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [api, params.splitSentences, params.groupSize, reduceMotion, watchPopups, watchResult, arm, step, goStep, drawerCall, jumpToField, outcome, plan?.kind, m.textCol, results, marks, state.compose, composeVersion, grouped, groupOrder, settle],
  );

  // New page content outside every placed part (a toast, a confirmation appended to the body) shows in a result card;
  // content inside a placed part already shows in place. A confirmation becomes the success panel instead.
  const result = useMemo<Block[] | null>(() => {
    if (!plan || !resultRoots.length) return null;
    const roots = resultRoots.filter((r) => {
      if (!r.isConnected || plan.roots.some((p) => p === r || p.contains(r))) return false;
      if (outcome && (outcome.el === r || outcome.el.contains(r) || r.contains(outcome.el))) return false;
      const t = textOf(r);
      return t.length > 0 && t.length < 600 && isShown(r);
    });
    const blocks = roots.slice(0, 3).flatMap((r) => readBlocks(r, newCtx()));
    return blocks.length ? blocks : null;
  }, [plan, resultRoots, version, outcome]);
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [!!result]);

  const popupBlocks = useMemo<Block[] | null>(() => {
    if (!popup || !popup.isConnected || !isShown(popup)) return null;
    if (plan?.popups.some((c) => c.el === popup || c.el.contains(popup) || popup.contains(c.el))) return null;
    const b = readBlocks(popup, newCtx());
    return b.length ? b : null;
  }, [popup, version, plan]);
  useEffect(() => {
    if (popup && !popupBlocks) setPopup(null);
  }, [popup, popupBlocks]);
  // A warning the page opens by itself while the view is open (a session-timeout dialog) is mirrored at once,
  // so nothing urgent stays hidden under the view.
  const seenPopups = useRef<Set<Element> | null>(null);
  useEffect(() => {
    const now = pagePopups();
    if (!seenPopups.current) {
      seenPopups.current = new Set(now);
      return;
    }
    const urgent = (p: Element): boolean =>
      p.matches('[role=alertdialog]') || !!p.querySelector('[role=alert]') ||
      (p.matches('[aria-modal=true],[role=dialog]') && /\b(session|time ?out|expir\w*|signed out|warning|error)\b/i.test(textOf(p)));
    const fresh = now.filter((p) => !seenPopups.current!.has(p) && urgent(p));
    now.forEach((p) => seenPopups.current!.add(p));
    if (fresh.length && !popup) setPopup(fresh[fresh.length - 1]!);
  }, [version]);
  const closePopup = (): void => {
    if (popup) proxyKey(popup, 'Escape');
    setPopup(null);
  };

  /* ---------- focus, keys, and telling the engine the person is using the view ---------- */

  useEffect(() => {
    mainRef.current?.focus({ preventScroll: true });
  }, []);

  const interacted = useRef(false);
  const signalInteraction = (): void => {
    settle.markInteracted();
    if (interacted.current) return;
    interacted.current = true;
    rootRef.current?.dispatchEvent(new CustomEvent('webable:calm-interact', { bubbles: true, composed: true }));
  };
  const onScroll = (e: Event): void => {
    const el = e.currentTarget as HTMLElement;
    // Never sideways (round 8b): a focus or scrollIntoView must not shift the page or its top bar.
    if (el.scrollLeft) el.scrollLeft = 0;
    if (el.scrollTop > 100) signalInteraction();
    settle.scrolled();
  };
  /** The person scrolling, clicking or typing in the view: from now on only groups off screen change. */
  const personActs = (): void => settle.markInteracted();

  const onKeyDown = (e: KeyboardEvent): void => {
    personActs();
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (popup) closePopup();
      else api.closeCalm();
      return;
    }
    if (e.key !== 'Tab') return;
    const root = rootRef.current?.getRootNode() as ShadowRoot | Document | undefined;
    if (!root) return;
    const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
    if (!all.length) return;
    const active = (root as ShadowRoot).activeElement ?? document.activeElement;
    const i = all.indexOf(active as HTMLElement);
    if (e.shiftKey && i === 0) {
      e.preventDefault();
      all[all.length - 1]!.focus();
    } else if (!e.shiftKey && i === all.length - 1) {
      e.preventDefault();
      all[0]!.focus();
    }
  };

  /* ---------- render ---------- */

  const empty = !plan || (!plan.main.length && !plan.hoisted.length && !plan.drawer.length && !plan.lead);
  const success = outcome?.kind === 'success' ? outcome : null;
  const error = outcome?.kind === 'error' ? outcome : null;
  const form = plan?.form ?? null;
  // The task's band: the form, else the primary part, else the first open part.
  const taskIdx = plan ? Math.max(0, plan.main.findIndex((p) => (form ? p.key === form.sectionKey : p.isPrimary))) : 0;
  const searchFirst = spec.task === 'search' || spec.task === 'navigate';
  const afterTask = plan ? (
    <>
      {plan.alerts.map((c) => (
        <div key={c.key} class="wa-band wa-band--tight">
          <NoticeCard card={c} />
        </div>
      ))}
      {!searchFirst && <SubStrip plan={plan} />}
      {plan.progress && <ProgressCard progress={plan.progress} />}
      {plan.help.length > 0 && (
        <section class="wa-band wa-band--tight" aria-label="Help">
          <HelpCard blocks={plan.help} />
        </section>
      )}
      {plan.consents.map((c) => (
        <div key={c.key} class="wa-band wa-band--tight">
          <NoticeCard card={c} />
        </div>
      ))}
    </>
  ) : null;

  return (
    <div
      ref={rootRef}
      class="wa-calm"
      role="region"
      aria-label="Simplified page"
      lang={document.documentElement.lang || undefined}
      data-scheme={tokens.scheme}
      data-mode={mode}
      data-motion={reduceMotion ? 'reduce' : undefined}
      data-f={String(m.F)}
      data-kind={plan?.kind}
      data-template={plan?.meaning?.template}
      data-docked={plan?.primary || plan?.form?.steps ? 'true' : undefined}
      style={style}
      onKeyDown={onKeyDown}
      onScroll={onScroll}
      onPointerDown={signalInteraction}
      onInput={signalInteraction}
      onWheel={personActs}
      onTouchMove={personActs}
    >
      {needInline && <style>{calmSheetCss()}</style>}
      <Calm.Provider value={ctx}>
        <Strip api={api} plan={plan} />
        <main ref={mainRef} class="wa-page" tabIndex={-1}>
          <div class={`wa-col${reduceMotion ? '' : ' wa-fade'}`} key={specKey(spec)} data-kind={plan?.kind}>
            {empty || !plan ? (
              <div class="wa-empty wa-stack" style={{ alignItems: 'center' }}>
                <p>WebAble could not simplify this page.</p>
                <button type="button" class="wa-btn wa-btn--tonal" onClick={() => api.closeCalm()}>
                  Original page
                </button>
              </div>
            ) : (
              <>
                {plan.popups.map((c) => (
                  <div key={c.key} class="wa-band wa-band--first">
                    <NoticeCard card={c} />
                  </div>
                ))}
                {success && <SuccessPanel outcome={success} help={plan.help} />}
                {plan.kind === 'article' && plan.article && !success ? (
                  <ArticleHeader lead={plan.lead} art={plan.article} readLine={readLine} listen={plan.listen} />
                ) : (
                  plan.lead && !success && !plan.meaning?.hideLead && <LeadBand lead={plan.lead} small={plan.kind === 'index'} />
                )}
                {/* Round 7: what the page exists to show comes right after its title (a recipe card carries its own title;
                    the page's intro follows it). */}
                {plan.meaning && !success && <PurposeView meaning={plan.meaning} leadTitle={plan.lead?.title ?? null} listFirst={params.listFirst} />}
                {plan.meaning?.hideLead && plan.lead && !success && (plan.lead.orient || plan.lead.pinned || plan.lead.about.length > 0) && (
                  <LeadBand lead={{ ...plan.lead, title: null, eyebrow: null }} />
                )}
                {searchFirst && plan.kind !== 'index' && <SubStrip plan={plan} />}
                {result && (
                  <div class="wa-band wa-band--tight" ref={resultRef}>
                    <div class="wa-result wa-fade" role="status">
                      <span class="wa-eyebrow">The page now shows</span>
                      <Blocks blocks={result} />
                    </div>
                  </div>
                )}
                {error && (
                  <div class="wa-band wa-band--tight">
                    <ErrorCard outcome={error} />
                  </div>
                )}
                {plan.kind === 'index' && plan.index ? (
                  <>
                    <IndexView index={plan.index} />
                    {/* The page's own top-bar links (Sign in, Search) after the stories, not between the title and the lead. */}
                    {searchFirst && <SubStrip plan={plan} />}
                    {afterTask}
                    {plan.main
                      .filter((p) => (p.sec.role === 'help' || p.sec.role === 'navigation') && !isMenu(p))
                      .map((p) => (
                        <SectionView key={p.key} p={p} form={null} />
                      ))}
                  </>
                ) : plan.portal ? (
                  <>
                    <PortalLinks portal={plan.portal} />
                    {afterTask}
                    <div class="wa-band wa-band--tight">
                      <Disclosure title={`All links (${plan.portal.total})`} sub="Everything else in the page’s own order">
                        {plan.main.filter((p) => !isMenu(p)).map((p) => (
                          <SectionView key={p.key} p={p} form={null} />
                        ))}
                      </Disclosure>
                    </div>
                  </>
                ) : (
                  plan.main.map((p, i) => {
                    if (isMenu(p)) return null;
                    if (success && form && p.key === form.sectionKey) return null;
                    return (
                      <Fragment key={p.key}>
                        <SectionView p={p} form={form} first={i === taskIdx} />
                        {i === taskIdx && !success && afterTask}
                      </Fragment>
                    );
                  })
                )}
                {(!plan.main.length || (success && taskIdx >= 0)) && !success && afterTask}
                {plan.chat && <ChatRow el={plan.chat} />}
                {plan.main.filter(isMenu).map((p) => (
                  <SectionView key={p.key} p={p} form={null} />
                ))}
                {!success && <MoreFrom plan={plan} bodyPx={m.F} />}
                <Drawer plan={plan} />
                <SiteLinks plan={plan} />
                <footer class="wa-foot">
                  <span>Words and controls come from this page. Arranged by WebAble.</span>
                  <button type="button" class="wa-btn wa-btn--quiet" onClick={() => api.closeCalm()}>
                    Original page
                  </button>
                </footer>
              </>
            )}
          </div>
        </main>
        {!empty && plan && <Dock plan={plan} outcome={outcome} />}
        {popupBlocks && (
          <div class="wa-popup" role="dialog" aria-label="From the page">
            <div class="wa-popup__head">
              <span class="wa-eyebrow">From the page</span>
              <button type="button" class="wa-btn wa-btn--quiet" onClick={closePopup} aria-label="Close this">
                <I.Close />
              </button>
            </div>
            <Blocks blocks={popupBlocks} />
          </div>
        )}
      </Calm.Provider>
    </div>
  );
}
