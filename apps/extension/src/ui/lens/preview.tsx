// Owner: L. A sample page for Lens v3, with the round-7 fields filled in and with them left off.
// Open preview.html (Vite transforms this file). Query: ?mode=empty, ?shot=1, ?card=n8.
import { render } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { decideElements, DEFAULT_SETTINGS, type ElementEvidence, type ElementJudgment, type FineRole, type PageDigest, type PageUnderstanding } from '@webable/core';
import type { EngineApi, EngineState } from '../../contracts';
import { Lens } from './Lens';
import { lensCss } from './lens.css';

type Mode = 'present' | 'empty';

function ev(id: string, over: Partial<ElementEvidence> = {}): ElementEvidence {
  return {
    id, tag: 'div', role_hint: 'region', label: id, zone: 'center_column', landmark: 'main', size: '200 x 80 px',
    position: 'middle', fixed: false, class_words: [], visual_weight: 'medium', ...over,
  };
}

function jd(
  id: string, role: ElementJudgment['role'], roleP: number, task: number, main = 0.05, help = 0.01,
): ElementJudgment {
  return { id, role, roleP, roleProbs: { [role]: roleP }, task, main, help };
}

function withFine(j: ElementJudgment, fine: FineRole, fineP: number, importance: number, fineProbs?: Record<string, number>): ElementJudgment {
  const next: ElementJudgment = { ...j, fine, fineP, importance };
  if (fineProbs) (next as ElementJudgment & { fineProbs: Record<string, number> }).fineProbs = fineProbs;
  return next;
}

const digest: PageDigest = {
  v: 'digest.1',
  page: {
    title: 'Kentucky',
    url_path: '/sports/football/opponent-history/kentucky',
    headings: ['Kentucky'],
    landmarks: ['banner', 'main'],
    viewport: 'desktop, 1440 x 900',
    element_count: 13,
  },
  elements: [
    ev('n1', { tag: 'header', role_hint: 'banner', label: 'Florida Gators', zone: 'header_band', landmark: 'banner', size: '1440 x 52 px', position: 'top', fixed: true }),
    ev('n2', { tag: 'h1', role_hint: 'heading', label: 'Kentucky', size: '420 x 48 px', position: 'top of main', visual_weight: 'high' }),
    ev('n3', { tag: 'section', role_hint: 'region', label: 'All-time record', size: '640 x 280 px', position: 'middle' }),
    ev('n4', { tag: 'div', role_hint: 'group', label: 'Wins', size: '140 x 88 px' }),
    ev('n5', { tag: 'div', role_hint: 'group', label: 'Losses', size: '140 x 88 px' }),
    ev('n6', { tag: 'div', role_hint: 'group', label: 'Home record', size: '140 x 88 px' }),
    ev('n7', { tag: 'div', role_hint: 'group', label: 'Away record', size: '140 x 88 px' }),
    ev('n8', { tag: 'div', role_hint: 'group', label: 'Last matchup', size: '640 x 72 px' }),
    ev('n9', { tag: 'img', role_hint: 'image', label: 'Florida', size: '48 x 48 px' }),
    ev('n10', { tag: 'img', role_hint: 'image', label: 'Kentucky logo', size: '48 x 48 px' }),
    ev('n11', { tag: 'aside', role_hint: 'region', label: 'More Gators stories', zone: 'right_rail', landmark: 'complementary', size: '300 x 160 px', class_words: ['teaser'] }),
    ev('n12', { tag: 'aside', role_hint: 'region', label: 'Sponsored', zone: 'right_rail', landmark: 'complementary', size: '300 x 180 px', class_words: ['ad', 'slot'] }),
    ev('n13', { tag: 'a', role_hint: 'link', label: 'Help', size: '80 x 28 px', position: 'below the record' }),
  ],
  regions: [
    ev('n3', { tag: 'section', role_hint: 'region', label: 'All-time record', size: '640 x 280 px' }),
    ev('n11', { tag: 'aside', role_hint: 'region', label: 'More Gators stories', zone: 'right_rail', landmark: 'complementary', size: '300 x 160 px' }),
  ],
  mainCandidates: [],
  hasSensitiveFields: false,
  lang: 'en',
};

const presentUnderstanding: PageUnderstanding = {
  elements: [
    withFine(jd('n1', 'navigation', 0.95, 0.22), 'site_nav', 0.9, 1),
    withFine(jd('n2', 'main_content', 0.96, 0.94), 'page_title', 0.95, 4),
    withFine(jd('n3', 'main_content', 0.97, 0.96), 'data_table', 0.9, 4),
    withFine(jd('n4', 'main_content', 0.94, 0.93), 'stat_value', 0.96, 4),
    withFine(jd('n5', 'main_content', 0.94, 0.93), 'stat_value', 0.95, 4),
    withFine(jd('n6', 'main_content', 0.93, 0.92), 'stat_value', 0.94, 4),
    withFine(jd('n7', 'main_content', 0.93, 0.9), 'stat_value', 0.92, 3),
    withFine(jd('n8', 'main_content', 0.95, 0.94), 'scoreboard', 0.91, 4, {
      scoreboard: 0.91, data_table: 0.04, stat_value: 0.03, chart: 0.01, key_fact: 0.006, other: 0.004,
    }),
    withFine(jd('n9', 'main_content', 0.9, 0.88), 'team_or_org_logo', 0.93, 4),
    withFine(jd('n10', 'main_content', 0.9, 0.88), 'team_or_org_logo', 0.92, 4),
    withFine(jd('n11', 'recommendations', 0.96, 0.04), 'teaser_other_content', 0.94, 0),
    withFine(jd('n12', 'advertising', 0.98, 0.02), 'advertising', 0.97, 0),
    withFine(jd('n13', 'help_contact', 0.99, 0.2, 0.02, 0.96), 'help_link', 0.93, 2),
  ],
  mainPick: { id: 'none', p: 0.74, probs: { none: 0.74 } },
  metrics: { model: 'jev-1.14.0', calls: 4, questions: 62, inputTokens: 18400, wallMs: 640, serverMs: 410, costUsd: 0.0018 },
  cached: false,
  purpose: {
    kind: 'record_stats',
    p: 0.97,
    probs: { record_stats: 0.97, scoreboard: 0.05, article: 0.03, schedule: 0.02, news_index: 0.01 },
  },
  mainRegion: { id: 'n3', p: 0.92, probs: { n3: 0.92, n11: 0.05, none: 0.03 } },
};

function emptyUnderstanding(full: PageUnderstanding): PageUnderstanding {
  return {
    elements: full.elements.map((j) => ({
      id: j.id, role: j.role, roleP: j.roleP, roleProbs: j.roleProbs, task: j.task, main: j.main, help: j.help,
    })),
    mainPick: full.mainPick,
    metrics: full.metrics,
    cached: full.cached,
  };
}

const LOCAL = { focusedIds: [], requiredIds: [], filledIds: [], consentIds: [], offsiteIds: [] };

function stateFor(mode: Mode): EngineState {
  const understanding = mode === 'present' ? presentUnderstanding : emptyUnderstanding(presentUnderstanding);
  return {
    phase: 'understood',
    fit: null,
    settings: { ...DEFAULT_SETTINGS },
    startedAt: 0,
    digest,
    outline: null,
    ops: [],
    checks: [],
    ledger: [],
    understanding,
    decisions: decideElements(understanding, digest, LOCAL),
    lens: { on: true },
    calm: { open: false, loading: false, spec: null, source: null, aiReady: false, redesign: null, visual: null },
    struggle: { latest: null, history: [], waiting: [], offers: [] },
    toasts: [],
    showingOriginal: false,
    overlays: [],
    ai: 'on',
    column: { on: false, widthPx: null, minPx: 720, maxPx: 1600 },
    textStep: 0,
    pageZoom: 1,
    passive: null,
    ...(paras() ? { reword: sampleReword } : {}),
  };
}

/** Round 9: ?paras=1 adds three paragraphs Jev read for this person (two rewritten, one kept). */
function paras(): boolean {
  return new URLSearchParams(location.search).get('paras') === '1';
}

const how = (keep: number, plain: number, list: number) => ({ keep, plain, list, shorter: 0.05, point_first: 0.05 });
const sampleReword: NonNullable<EngineState['reword']> = {
  status: 'done',
  source: 'ChatGPT',
  showingOriginal: false,
  version: 1,
  items: [
    { id: 'w1', need: 0.84, how: how(0.1, 0.7, 0.1), pick: 'plain', state: 'rewritten', snippet: 'The series dates to 1917' },
    { id: 'w2', need: 0.77, how: how(0.15, 0.1, 0.65), pick: 'list', state: 'failed', reason: 'numbers', snippet: 'Tickets for the home game' },
    { id: 'w3', need: 0.12, how: how(0.85, 0.05, 0.05), pick: null, state: 'kept', snippet: 'Florida leads the series' },
  ],
};

const api: EngineApi = {
  getState: () => stateFor('present'),
  subscribe: () => () => {},
  elementFor: (id) => document.getElementById(id),
  toggleLens: () => {},
  openCalm: async () => {},
  closeCalm: () => {},
  useAiLayout: () => {},
  showOriginal: () => {},
  undoOp: () => {},
  acceptOffer: () => {},
  dismissOffer: () => {},
  dismissToast: () => {},
  openFitting: () => {},
  restoreOverlay: () => {},
  adjustColumn: () => {},
  adjustText: () => {},
  passiveFeedback: () => {},
  showOriginalWords: () => {},
  toggleParagraph: () => {},
  rewordFor: () => null,
  compose: () => {},
};

const pageCss = `
body { margin: 0; background: #f3f0e8; color: #1c1c1c; font-family: Georgia, "Iowan Old Style", Palatino, "Palatino Linotype", serif; }
.gators { box-sizing: border-box; max-width: 920px; padding: 72px 28px 64px; }
.gators.wide { margin-left: 320px; }
.gators header { display: flex; align-items: center; gap: 18px; height: 52px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-weight: 650; letter-spacing: -0.01em; }
.mark { width: 28px; height: 28px; border-radius: 6px; background: #0021a5; color: #fff; display: grid; place-items: center; font-size: 12px; }
.gators h1 { margin: 18px 0 0; font-size: 42px; font-weight: 650; letter-spacing: -0.02em; }
.dek { margin: 4px 0 18px; color: #4a4a4a; font-size: 18px; }
.layout { display: grid; grid-template-columns: minmax(0, 1fr) 240px; gap: 28px; align-items: start; }
.record { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px 12px; background: #fff; padding: 16px 16px 12px; }
.record h2 { grid-column: 1 / -1; margin: 0 0 4px; font-size: 15px; font-weight: 650; letter-spacing: 0.04em; text-transform: uppercase; color: #5c5c5c; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.stat b { display: block; font-size: 34px; font-variant-numeric: tabular-nums; letter-spacing: -0.03em; }
.stat span { color: #555; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 14px; }
.board { grid-column: 1 / -1; display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 6px; padding: 10px 12px; background: #f7f6f2; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.side { display: flex; align-items: center; gap: 10px; }
.logo { width: 48px; height: 48px; border-radius: 8px; display: grid; place-items: center; color: #fff; font-weight: 700; }
.logo.uf { background: #0021a5; }
.logo.uk { background: #0033a0; }
.score { font-size: 28px; font-variant-numeric: tabular-nums; font-weight: 700; }
.when { text-align: center; color: #555; font-size: 13px; }
.when b { display: block; color: #1c1c1c; font-size: 13px; }
.teaser, .ad { background: #fff; padding: 12px 14px; margin: 0 0 12px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.teaser h3, .ad h3 { margin: 0 0 6px; font-size: 14px; }
.teaser p, .ad p { margin: 0; color: #444; font-size: 14px; line-height: 1.4; }
.ad { background: #efe8da; min-height: 150px; }
.story { margin-top: 24px; font-size: 18px; line-height: 1.55; }
.story p { margin: 0 0 16px; }
.help { display: inline-block; margin-top: 16px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.switch { position: fixed; left: 16px; bottom: 16px; z-index: 40; display: flex; gap: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 13px; }
.switch a { color: #1c1c1c; background: #fff; padding: 8px 12px; border-radius: 999px; text-decoration: none; box-shadow: 0 1px 4px rgba(0,0,0,.15); }
.switch a[aria-current="true"] { background: #1c1c1c; color: #fff; }
`;

function Page() {
  return (
    <div class={paras() ? 'gators wide' : 'gators'}>
      <header id="n1"><span class="mark">UF</span> Florida Gators · Football</header>
      <div class="layout">
        <div>
          <h1 id="n2">Kentucky</h1>
          <p class="dek">Opponent history</p>
          <section class="record" id="n3">
            <h2>All-time record</h2>
            <div class="stat" id="n4"><b>54</b><span>Wins</span></div>
            <div class="stat" id="n5"><b>22</b><span>Losses</span></div>
            <div class="stat" id="n6"><b>30-6</b><span>Home record</span></div>
            <div class="stat" id="n7"><b>22-13</b><span>Away record</span></div>
            <div class="board" id="n8">
              <div class="side" id="n9"><span class="logo uf">UF</span><span>Florida</span><b class="score">7</b></div>
              <div class="when"><b>Last matchup</b>Nov 8, 2025</div>
              <div class="side" id="n10"><b class="score">38</b><span>Kentucky</span><span class="logo uk">UK</span></div>
            </div>
          </section>
          <a class="help" id="n13" href="#help">Help</a>
          {paras() && (
            <div class="story">
              <p id="w1">The series dates to 1917, and the rivalry has been contested annually since 1967 under the conference's scheduling arrangement for divisional opponents.</p>
              <p id="w2">Tickets for the home game are allocated first to season holders in priority order, then released to the general public on the Monday before kickoff at 10 a.m.</p>
              <p id="w3">Florida leads the series 54 to 22.</p>
            </div>
          )}
        </div>
        <aside>
          <div class="teaser" id="n11">
            <h3>More stories</h3>
            <p>Five things to know before Saturday. A photo from another game leads the rail.</p>
          </div>
          <div class="ad" id="n12">
            <h3>Sponsored</h3>
            <p>A partner offer that has nothing to do with the series record.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}

function readMode(): Mode {
  return new URLSearchParams(location.search).get('mode') === 'empty' ? 'empty' : 'present';
}

export function Preview() {
  const [mode] = useState<Mode>(readMode);
  const shot = new URLSearchParams(location.search).get('shot') === '1';
  const s = useMemo(() => stateFor(mode), [mode]);
  useEffect(() => {
    if (mode !== 'present') return;
    let n = 0;
    const timer = window.setInterval(() => {
      const btn = [...document.querySelectorAll('.wa-lseg [role="tab"]')].find((el) => el.textContent?.trim() === 'Page');
      if (btn instanceof HTMLElement) {
        btn.click();
        window.clearInterval(timer);
      } else if (++n > 30) window.clearInterval(timer);
    }, 80);
    return () => window.clearInterval(timer);
  }, [mode]);
  useEffect(() => {
    const id = new URLSearchParams(location.search).get('card');
    if (!id) return;
    const timer = window.setTimeout(() => {
      const el = document.getElementById(id);
      if (!el) return;
      const b = el.getBoundingClientRect();
      window.dispatchEvent(new PointerEvent('pointermove', {
        clientX: b.left + Math.min(24, b.width / 2),
        clientY: b.top + Math.min(20, b.height / 2),
        bubbles: true,
        pointerType: 'mouse',
      }));
    }, 700);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <>
      {!shot && (
        <nav class="switch" data-wa-chrome="" aria-label="Sample">
          <a href="?mode=present" aria-current={mode === 'present' ? 'true' : undefined}>Fields present</a>
          <a href="?mode=empty" aria-current={mode === 'empty' ? 'true' : undefined}>Fields empty</a>
        </nav>
      )}
      <Lens api={api} s={s} reduce={shot} bottomReserve={shot ? 16 : 72} />
    </>
  );
}

const pageHost = document.getElementById('wa-lens-page');
const lensHost = document.getElementById('wa-lens-preview');
if (pageHost && lensHost) {
  const style = document.createElement('style');
  style.textContent = `${pageCss}\n${lensCss}`;
  document.head.append(style);
  render(<Page />, pageHost);
  render(<Preview />, lensHost);
}
