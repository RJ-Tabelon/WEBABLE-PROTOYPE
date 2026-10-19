import type {
  PageContext,
  PageSignals,
  RegionEvidence,
} from '@webable/core/page/types';

import type { PageEvidence } from '../../protocol';
import { countToBucket } from '../contract';
import type {
  ContrastSample,
  ExtractPerf,
  Extraction,
  PageFacts,
  PinnedFact,
  RegionFact,
  TargetFact,
  TextFact,
  VocabPort,
} from '../types';
import {
  median,
  pageHeightBucket,
  pageTextBucket,
  pinnedBarsBucket,
  round,
  viewportClass,
  weightedMedian,
  widthBucket,
} from '../util/buckets';
import {
  ACTIONABLE_SELECTOR,
  composedContains,
  directText,
  directTextLength,
  isIconFont,
  isRendered,
  type TreeScope,
} from '../util/dom';
import { spacingFailures, type SpacingTarget } from '../util/geometry';
import { Budget } from '../util/schedule';
import { classifyPage } from './classify';
import { measureContrast, type LayerCache } from './contrast';
import { regionEvidence, repeatedCards, validatePageContext } from './evidence';
import { detectHoverMenus } from './hover';
import { findMainContent, isProbablyReaderable } from './main';
import { LayoutCollector, layoutFeatures } from './layout';
import { motionInventory } from './motion';
import { keyFor, segmentRegions } from './regions';
import { DECIDED_PRECISION } from './rules';
import { computeSignals, orderedSignals } from './signals';
import { fontWeightNum, lineHeightPx, lineLengths } from './text';
import { walk } from './walk';

export interface ExtractOptions {
  vocab: VocabPort;
  openClosed?: (el: Element) => ShadowRoot | null;
  /** Main-thread budget for the element walk, ms (engine.md 5). */
  walkBudgetMs?: number;
  maxNodes?: number;
  now?: () => number;
  /** Restore adaptations while yielding, so baseline measurement never paints. */
  yieldMain?: () => Promise<void>;
  /** Previously covered live nodes, to retain coverage when a walk is truncated. */
  previousFacts?: PageFacts;
}

export const TARGET_LADDER = [24, 32, 44, 56, 72] as const;
/** Text sampled for contrast, and those in view whose background a hit test confirms. */
const CONTRAST_SAMPLES = 100;
const CONTRAST_HIT_TESTS = 24;
/** Tags that can match ACTIONABLE_SELECTOR without a role, tabindex or contenteditable. */
const ACTIONABLE_TAGS: ReadonlySet<string> = new Set([
  'a',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  'label',
]);

const LEAF_TEXT_EXCLUDE = new Set([
  'code',
  'pre',
  'kbd',
  'samp',
  'option',
  'textarea',
  'select',
]);
const TEXT_INPUT_SELECTOR =
  'input:not([type]), input[type="text"], input[type="search"], input[type="email"], input[type="tel"], input[type="url"], input[type="password"], input[type="number"], textarea';
const PAYMENT_SELECTOR =
  '[autocomplete^="cc-"], input[name*="cardnumber" i], input[name*="card_number" i], input[name*="card-number" i], input[name*="cvc" i], input[name*="cvv" i], input[id*="cardnumber" i]';
const DRAG_SELECTOR =
  '[draggable="true"]:not(img):not(a), [aria-roledescription="sortable" i], [aria-roledescription="draggable" i], [data-rbd-draggable-id], [data-rfd-draggable-id], .ui-sortable, .ui-draggable';

/**
 * Budgeted, chunked page extraction (engine.md 2). Produces:
 *  - PageSignals: exact local measurements for the policy (never leave the device);
 *  - PageEvidence: vocabulary-filtered, bucketed structure (the only thing that can);
 *  - PageFacts: element references for the ops.
 */
export async function extract(
  doc: Document,
  opts: ExtractOptions,
): Promise<Extraction> {
  const now = opts.now ?? (() => performance.now());
  const t0 = now();
  const view = doc.defaultView;
  if (!view || !doc.body)
    throw new Error('extract: document has no view or body');
  const walkBudget = new Budget(
    opts.walkBudgetMs ?? 20,
    5,
    now,
    opts.yieldMain,
  );
  const vw = view.innerWidth;
  const vh = view.innerHeight;
  const sx = view.scrollX;
  const sy = view.scrollY;

  // ---- 1. One budgeted walk ------------------------------------------------
  const texts: Array<TextFact & { display: string }> = [];
  const targetEls: Element[] = [];
  const targetSet = new Set<Element>();
  const pointerCursor = new WeakMap<Element, boolean>();
  const pinnedEls: Array<{ el: Element; position: 'fixed' | 'sticky' }> = [];
  const counts = { links: 0, buttons: 0, headings: 0, images: 0, videos: 0 };
  const visited = new Set<Element>();
  const layout = new LayoutCollector();

  const visit = (el: Element, cs: CSSStyleDeclaration): void => {
    visited.add(el);
    const tag = el.localName;
    const pointer = cs.cursor === 'pointer';
    pointerCursor.set(el, pointer);
    // Only these tags and attributes can match ACTIONABLE_SELECTOR: a few
    // attribute reads spare most elements the selector match (eval M9).
    const maybeActionable =
      ACTIONABLE_TAGS.has(tag) ||
      el.hasAttribute('role') ||
      el.hasAttribute('tabindex') ||
      el.hasAttribute('contenteditable');
    if (maybeActionable && el.matches(ACTIONABLE_SELECTOR)) {
      if (targetEls.length < 2000) {
        targetEls.push(el);
        targetSet.add(el);
      }
    } else if (
      pointer &&
      el.parentElement &&
      !pointerCursor.get(el.parentElement) &&
      targetEls.length < 2000
    ) {
      targetEls.push(el);
      targetSet.add(el);
    }
    const position = cs.position;
    if (position === 'fixed' || position === 'sticky')
      pinnedEls.push({ el, position });
    layout.visit(el, cs, position);
    if (tag === 'a' && el.hasAttribute('href')) counts.links++;
    else if (tag === 'button' || el.getAttribute('role') === 'button')
      counts.buttons++;
    else if (/^h[1-6]$/.test(tag)) counts.headings++;
    else if (tag === 'img') counts.images++;
    else if (tag === 'video') counts.videos++;
    if (LEAF_TEXT_EXCLUDE.has(tag)) return;
    const chars = directTextLength(el);
    if (chars === 0) return;
    const fontPx = parseFloat(cs.fontSize);
    if (!Number.isFinite(fontPx) || fontPx <= 0) return;
    const display = cs.display;
    layout.noteText(el, cs, display);
    texts.push({
      el,
      chars,
      fontPx,
      lineHeightPx: lineHeightPx(cs),
      weight: fontWeightNum(cs),
      family: cs.fontFamily,
      inMain: false,
      icon: isIconFont(cs.fontFamily, chars <= 4 ? directText(el, 8) : ''),
      display,
    });
  };
  const stats = await walk(doc, visit, walkBudget, {
    maxNodes: opts.maxNodes ?? 6000,
    openClosed: opts.openClosed,
  });
  walkBudget.pause();
  const scopes: TreeScope[] = [doc, ...stats.shadowRoots];

  // The rest runs in bounded slices; measure it on its own budget.
  const rest = new Budget(40, 5, now, opts.yieldMain);
  const phases: Record<string, number> = { walk: round(walkBudget.used, 2) };
  let lapFrom = 0;
  const lap = (name: string): void => {
    const u = rest.used;
    phases[name] = round(u - lapFrom, 2);
    lapFrom = u;
  };

  // A time-limited walk is not evidence that previously fitted nodes vanished.
  // Re-read the known live candidates it missed, rather than removing their
  // marks or reusing stale host styles after a framework changes their class.
  if (stats.truncated && opts.previousFacts) {
    const previous = opts.previousFacts;
    const candidates = new Set([
      ...previous.text.map((t) => t.el),
      ...previous.targets.map((t) => t.el),
      ...previous.pinned.map((t) => t.el),
    ]);
    let n = 0;
    for (const el of candidates) {
      if (!el.isConnected || visited.has(el) || !isRendered(el)) continue;
      visit(el, view.getComputedStyle(el));
      if ((++n & 31) === 0) await rest.tick();
    }
    for (const scope of previous.scopes) {
      if (
        scope instanceof ShadowRoot &&
        scope.host.isConnected &&
        !scopes.includes(scope)
      )
        scopes.push(scope);
    }
  }
  lap('coverage');

  // ---- 2. Main content -----------------------------------------------------
  const mainRes = findMainContent(doc, { visible: (el) => isRendered(el) });
  const main = mainRes.el;
  const inMain = (el: Element): boolean =>
    main ? composedContains(main, el) : false;
  for (const t of texts) t.inMain = inMain(t.el);
  lap('main');
  await rest.tick();

  // ---- 3. Text metrics -----------------------------------------------------
  const body = texts.filter((t) => !t.icon);
  const hasMain = main !== null && body.some((t) => t.inMain);
  const hist = new Map<number, number>();
  let totalChars = 0;
  let mainChars = 0;
  for (const t of body) {
    totalChars += t.chars;
    if (t.inMain) mainChars += t.chars;
    const w = !hasMain || t.inMain ? 1 : 0.5;
    const px = Math.round(t.fontPx);
    hist.set(px, (hist.get(px) ?? 0) + t.chars * w);
  }
  const mainTexts = hasMain ? body.filter((t) => t.inMain) : body;
  const mainFontPx = weightedMedian(
    mainTexts.map((t) => [t.fontPx, t.chars] as const),
  );
  const mainLh = weightedMedian(
    mainTexts.map(
      (t) => [(t.lineHeightPx ?? t.fontPx * 1.2) / t.fontPx, t.chars] as const,
    ),
  );
  const cpl = median(lineLengths(mainTexts, view));
  const weightPool = body.filter((t) => t.chars >= 40);
  const minWeight = (weightPool.length ? weightPool : body).reduce(
    (m, t) => Math.min(m, t.weight),
    900,
  );
  lap('text');
  await rest.tick();

  // ---- 4. Contrast sampling --------------------------------------------------
  const rects = new Map<Element, DOMRect>();
  const rectOf = (el: Element): DOMRect => {
    let r = rects.get(el);
    if (!r) rects.set(el, (r = el.getBoundingClientRect()));
    return r;
  };
  const inViewport = (r: DOMRect): boolean =>
    r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw;
  const pool = body.slice(0, 600);
  const ranked = pool
    .map((t) => ({ t, vis: inViewport(rectOf(t.el)) }))
    .sort(
      (a, b) =>
        Number(b.vis) * 2 +
        Number(b.t.inMain) -
        (Number(a.vis) * 2 + Number(a.t.inMain)),
    );
  const contrast = { sampled: 0, below45: 0, below7: 0, unknownBackground: 0 };
  const contrastSamples: ContrastSample[] = [];
  const layers: LayerCache = new Map();
  let hitTests = 0;
  for (const { t, vis } of ranked.slice(0, CONTRAST_SAMPLES)) {
    // Past CONTRAST_HIT_TESTS samples in view, the ancestor chain decides
    // alone: each hit test costs about 0.15 ms on a large page (eval M9).
    const m = measureContrast(
      t.el,
      view,
      vis && hitTests < CONTRAST_HIT_TESTS,
      layers,
    );
    if (vis) hitTests++;
    contrast.sampled++;
    if (m.ratio === null || !m.fg || !m.bg) {
      contrast.unknownBackground++;
    } else {
      if (m.ratio < 4.5) contrast.below45++;
      if (m.ratio < 7) contrast.below7++;
      if (vis && contrastSamples.length < 60) {
        contrastSamples.push({
          el: t.el,
          ratio: m.ratio,
          fg: m.fg,
          bg: m.bg,
          inViewport: vis,
        });
      }
    }
    if (!(await rest.tick())) break;
  }

  lap('contrast');

  // ---- 5. Targets and the 2.5.8 spacing test --------------------------------
  const targets: TargetFact[] = [];
  let id = 0;
  for (const el of targetEls) {
    // A label wrapping an input (or nested actionables) is one target: keep the outer.
    let skip = false;
    let a = el.parentElement;
    for (let i = 0; a && i < 3; i++, a = a.parentElement) {
      if (targetSet.has(a)) {
        skip = true;
        break;
      }
    }
    if (skip) continue;
    const r = rectOf(el);
    if (r.width < 1 || r.height < 1) continue;
    const cs = view.getComputedStyle(el);
    const inline =
      cs.display === 'inline' &&
      el.parentElement !== null &&
      directTextLength(el.parentElement) > 0;
    targets.push({
      id: id++,
      el,
      box: {
        left: r.left + sx,
        top: r.top + sy,
        right: r.right + sx,
        bottom: r.bottom + sy,
      },
      inline,
      minSide: Math.min(r.width, r.height),
    });
    if (targets.length >= 1500) break;
  }
  const below = {
    '24': 0,
    '32': 0,
    '44': 0,
    '56': 0,
    '72': 0,
  } as PageSignals['targets']['below'];
  for (const t of targets) {
    if (t.inline) continue;
    for (const size of TARGET_LADDER)
      if (t.minSide < size) below[String(size) as keyof typeof below]++;
  }
  const spacing: SpacingTarget[] = targets
    .filter((t) => !t.inline)
    .map((t) => ({ id: t.id, box: t.box, small: t.minSide < 24 }));
  const crowded = spacingFailures(spacing, 24).size;
  lap('targets');
  await rest.tick();

  // ---- 6. Motion, pinned layers, hover menus, drag, forms --------------------
  const motion = motionInventory(scopes);
  const pinned: PinnedFact[] = [];
  let bars = 0;
  let topBand = 0;
  for (const p of pinnedEls) {
    const r = rectOf(p.el);
    if (r.width < 1 || r.height < 1) continue;
    const areaPct = (r.width * r.height) / (vw * vh);
    const barLike =
      r.width >= 0.9 * vw && r.height >= 24 && r.height < 0.5 * vh;
    const atTop = r.top <= 8 && r.bottom > 0;
    const atBottom = r.bottom >= vh - 8 && r.top < vh;
    if (barLike && (atTop || atBottom)) {
      bars++;
      if (atTop) topBand = Math.max(topBand, r.bottom);
    }
    if (areaPct >= 0.03 || barLike) {
      pinned.push({
        el: p.el,
        position: p.position,
        box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
      });
    }
  }
  const hoverMenus = detectHoverMenus(doc);
  const dragOnly = doc.querySelectorAll(DRAG_SELECTOR).length;
  const requiredFields = doc.querySelectorAll(
    'input[required]:not([type="hidden"]), select[required], textarea[required], [aria-required="true"]',
  ).length;
  const hasPassword = doc.querySelector('input[type="password"]') !== null;
  const hasPayment = doc.querySelector(PAYMENT_SELECTOR) !== null;
  const formCount = doc.forms.length;
  const textInputs = doc.querySelectorAll(TEXT_INPUT_SELECTOR).length;
  lap('motion_forms');
  await rest.tick();

  // ---- 7. Regions --------------------------------------------------------------
  const regionFacts = segmentRegions({
    doc,
    main,
    mainCandidates: mainRes.ambiguous ? mainRes.candidates : [],
    pinned,
    motion,
  });
  const registry = new Map<string, RegionFact[]>();
  for (const f of regionFacts) {
    const list = registry.get(f.key);
    if (list) list.push(f);
    else registry.set(f.key, [f]);
  }
  const mainFact = main ? regionFacts.find((f) => f.el === main) : undefined;
  const mainKey = main ? (mainFact?.key ?? keyFor(main)) : null;
  lap('regions');
  await rest.tick();

  // ---- 8. Page category ------------------------------------------------------------
  const readerable = isProbablyReaderable(doc, (el) => isRendered(el));
  const cardsInMain = main ? repeatedCards(main) : repeatedCards(doc.body);
  const signalSet = computeSignals({
    doc,
    main,
    readerable,
    hasPassword,
    hasPayment,
    repeatedCardsInMain: cardsInMain,
    viewportArea: vw * vh,
    visible: (el) => isRendered(el),
  });
  const category = classifyPage({
    signals: signalSet,
    structuredMain:
      mainRes.foundBy === 'landmark' || mainRes.foundBy === 'single_article',
    mainTextShare: totalChars ? mainChars / totalChars : 0,
    textChars: totalChars,
    controlsPerKChars: targets.length / Math.max(1, totalChars / 1000),
    repeatedCards: cardsInMain,
    forms: formCount,
    requiredFields,
  });

  lap('category');

  // ---- 8b. Layout features for triage (docs/10 §3.1) -------------------------
  const layoutF = layoutFeatures({
    doc,
    scopes,
    collector: layout,
    texts: body,
    main,
    regions: regionFacts,
    mainFontPx: mainFontPx === null ? null : round(mainFontPx, 1),
    jsonldProduct: signalSet.has('jsonld_product'),
    rectOf,
    openClosed: opts.openClosed,
    lap,
  });
  lap('layout');

  // ---- 9. Assemble PageSignals (local) ---------------------------------------------
  const mq = (q: string): boolean => {
    try {
      return view.matchMedia(q).matches;
    } catch {
      return false;
    }
  };
  const lang =
    (doc.documentElement.lang || 'und')
      .toLowerCase()
      .replace(/[^a-z-]/g, '')
      .slice(0, 12) || 'und';
  const signals: PageSignals = {
    v: 1,
    lang,
    category: category.top,
    categoryConfidence: category.p,
    viewport: {
      width: vw,
      height: vh,
      dpr: view.devicePixelRatio || 1,
      zoom: round(view.visualViewport?.scale ?? 1, 2),
    },
    text: {
      histogram: [...hist.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([px, c]) => [px, Math.round(c)]),
      totalChars,
      mainFontPx: mainFontPx === null ? null : round(mainFontPx, 1),
      mainLineHeight: mainLh === null ? null : round(mainLh, 2),
      mainLineCh: cpl === null ? null : Math.round(cpl),
      minWeight: body.length ? minWeight : 400,
    },
    contrast,
    targets: { count: targets.length, below, crowded },
    motion: {
      running: motion.running,
      infinite: motion.infinite,
      autoplayMedia: motion.autoplayMedia,
      carousels: motion.carousels,
      animatedImages: motion.animatedImages,
    },
    sticky: { bars, topBandPx: Math.round(topBand) },
    hoverMenus: hoverMenus.length,
    dragOnly,
    forms: { count: formCount, requiredFields, hasPassword, hasPayment },
    main: { key: mainKey, ambiguous: mainRes.ambiguous },
    regions: regionFacts.map((f) => {
      const decided = f.rule !== null && f.rule.precision >= DECIDED_PRECISION;
      return {
        key: f.key,
        zone: f.zone,
        areaPct: f.areaPct,
        pinned: f.pinned,
        ruleRole: decided && f.rule ? f.rule.role : null,
        rulePrecision: decided && f.rule ? f.rule.precision : 0,
        ruleId: decided && f.rule ? f.rule.ruleId : null,
        hasRequiredFields: f.hasRequiredFields,
        containsFocus: f.containsFocus,
        motion: f.motion,
      };
    }),
    env: {
      reducedMotion: mq('(prefers-reduced-motion: reduce)'),
      forcedColors: mq('(forced-colors: active)'),
      colorScheme: mq('(prefers-color-scheme: dark)') ? 'dark' : 'light',
    },
    layout: layoutF,
  };

  // ---- 10. Evidence (vocabulary-filtered; the only thing that may leave) -------------
  const docH = Math.max(doc.documentElement.scrollHeight, vh);
  const pageCtx: PageContext = {
    signals: orderedSignals(signalSet),
    main: {
      found_by: mainRes.foundBy,
      zone: mainFact?.zone ?? 'unknown',
      width: mainFact
        ? widthBucket(((mainFact.box.right - mainFact.box.left) / vw) * 100)
        : 'unknown',
    },
    counts: {
      regions: countToBucket(regionFacts.length),
      links: countToBucket(counts.links),
      buttons: countToBucket(counts.buttons),
      text_inputs: countToBucket(textInputs),
      forms: countToBucket(formCount),
      required_fields: countToBucket(requiredFields),
      headings: countToBucket(counts.headings),
      images: countToBucket(counts.images),
      videos: countToBucket(counts.videos),
      text_amount: pageTextBucket(totalChars),
    },
    layout: {
      viewport: viewportClass(vw),
      page_height: pageHeightBucket(docH / vh),
      pinned_bars: pinnedBarsBucket(bars),
    },
  };
  const page = validatePageContext(pageCtx);
  if (!page) throw new Error('extract: page context failed validation');

  const evCtx = { vocab: opts.vocab, main, viewportW: vw, viewportH: vh };
  const regionsOut: Record<string, RegionEvidence> = {};
  const relevance = (f: RegionFact): number =>
    f.pinned !== 'no'
      ? 2
      : f.zone === 'left_rail' ||
          f.zone === 'right_rail' ||
          f.zone === 'header_band'
        ? 1.5
        : 1;
  const ambiguous = regionFacts
    .filter(
      (f) =>
        (f.areaPct >= 1.5 || f.pinned !== 'no') &&
        f.el !== main &&
        !f.containsMain &&
        !f.hasRequiredFields &&
        !(f.rule && f.rule.precision >= DECIDED_PRECISION),
    )
    .sort((a, b) => b.areaPct * relevance(b) - a.areaPct * relevance(a));
  for (const f of ambiguous) {
    if (Object.keys(regionsOut).length >= 10) break;
    if (regionsOut[f.key]) continue;
    const ev = regionEvidence(f, evCtx);
    if (ev) regionsOut[f.key] = ev;
  }
  let mainCandidates: string[] | undefined;
  if (mainRes.ambiguous && mainRes.candidates.length >= 2) {
    const keys: string[] = [];
    for (const c of mainRes.candidates.slice(0, 4)) {
      const f = regionFacts.find((r) => r.el === c);
      if (!f) continue;
      const ev = regionsOut[f.key] ?? regionEvidence(f, evCtx);
      if (!ev) continue;
      regionsOut[f.key] = ev;
      if (!keys.includes(f.key)) keys.push(f.key);
    }
    if (keys.length >= 2) mainCandidates = keys;
  }
  const evidence: PageEvidence = mainCandidates
    ? { page, regions: regionsOut, mainCandidates }
    : { page, regions: regionsOut };

  const facts: PageFacts = {
    doc,
    scopes,
    main,
    mainFoundBy: mainRes.foundBy,
    mainCandidates: mainRes.candidates,
    text: texts.map(({ display: _display, ...t }) => t),
    targets,
    pinned,
    regions: registry,
    hoverMenus,
    carousels: motion.carouselEls,
    videos: motion.videos,
    gifs: motion.gifs,
    contrast: contrastSamples,
    measuredAt: now(),
  };
  lap('evidence');
  const perf: ExtractPerf = {
    busyMs: round(walkBudget.used + rest.used, 1),
    wallMs: round(now() - t0, 1),
    nodes: stats.nodes,
    truncated: stats.truncated,
    phases,
  };
  return { signals, evidence, facts, perf };
}
