import { describe, expect, it } from 'vitest';

import { OP_CATALOG, OP_IDS, type OpId } from '../ops/catalog';
import { planWithTraces } from '../policy/decide';
import {
  articleSignals,
  focusProfile,
  govukSignals,
  highDistractionProfile,
  largeTargetProfile,
  largeTextProfile,
  makeInput,
  triageFor,
  wikipediaSignals,
  youtubeSignals,
} from '../policy/fixtures';
import { TRIAGE_VERSION } from '../versions';
import type { TriageReason, TriageVerdict } from '../triage/types';
import {
  VERIFY_CODES,
  type AppliedChange,
  type DecisionSource,
  type DecisionTrace,
  type TraceEvidence,
} from '../policy/types';
import { OP_LABELS } from './glossary';
import {
  explainChange,
  explainUndone,
  formatFit,
  formatLevel,
  NBSP,
  offerQuestion,
  triageLine,
} from './templates';

const trace = (
  op: OpId,
  evidence: TraceEvidence[],
  patch: Partial<DecisionTrace> = {},
): DecisionTrace => ({
  op,
  mode: 'auto',
  source: 'profile',
  level: 0,
  p: 0.8,
  pOk: 0.9,
  why: 'auto',
  evidence,
  ...patch,
});

const change = (
  t: DecisionTrace,
  patch: Partial<AppliedChange> = {},
): AppliedChange => ({
  op: t.op,
  level: t.level,
  mode: t.mode === 'offer' ? 'offer' : 'auto',
  status: 'applied',
  count: 3,
  trace: t,
  ...patch,
});

/** Every rule in design-final.md 13.1 that a string can be checked against. */
const BANNED = [
  /\bdisab/i,
  /\bimpair/i,
  /\blow vision\b/i,
  /\badhd\b/i,
  /\bpatient/i,
  /\bsymptom/i,
  /\bdiagnos/i,
  /\bnormal\b/i,
  /\btests?\b/i,
  /\bscores?\b/i,
  /\bresults?\b/i,
  /\bassess/i,
  /\bacuity\b/i,
  /\bAI\b/,
  /\bsmart\b/i,
  /\bmagic/i,
  /\bseamless/i,
  /\bWCAG\b/i,
  /\bcomplian/i,
  /\bconformance\b/i,
  /\bfix(es|ed)?\b/i,
  /\bI think\b/i,
  /!/,
  /[→✓✔↩⟲←↑↓]/,
];

function checkCopy(text: string): void {
  expect(text.trim()).toBe(text);
  expect(text.length).toBeGreaterThan(0);
  for (const pattern of BANNED)
    expect(text, `${pattern} in "${text}"`).not.toMatch(pattern);
  // Digits with units take a no-break space.
  expect(text, text).not.toMatch(/\d (px|ms|characters)\b/);
  for (const sentence of text.split(/(?<=[.?])\s+/)) {
    expect(sentence, sentence).toMatch(/^[A-Z0-9]/);
    expect(sentence.split(/\s+/).length, sentence).toBeLessThanOrEqual(20);
  }
}

describe('the design voice examples', () => {
  it('explains a text floor with real values', () => {
    const t = trace(
      'text_floor',
      [{ kind: 'small_text', share: 0.7, floorPx: 18, beforePx: 13 }],
      { level: 2 },
    );
    expect(
      explainChange(change(t, { fit: { before: '13', after: '18 px' } })),
    ).toEqual({
      title: 'Text size',
      detail: `Most text here was 13${NBSP}px. WebAble raised it to your 18${NBSP}px.`,
    });
  });

  it('asks about small buttons', () => {
    const t = trace(
      'target_size',
      [{ kind: 'target_failures', count: 18, targetPx: 44 }],
      { mode: 'offer' },
    );
    expect(offerQuestion(t)).toEqual({
      question: 'Buttons on this page are small. Make them bigger here?',
      reason: `18 links and buttons here are smaller than 44${NBSP}px.`,
    });
    const nudged = trace(
      'target_size',
      [{ kind: 'friction', signal: 'misclick_burst' }],
      { mode: 'offer', source: 'friction' },
    );
    expect(offerQuestion(nudged).reason).toBe(
      'You clicked just next to a few buttons in the last minute.',
    );
    // With the measured median, the reason says how big the buttons are.
    const measured = trace(
      'target_size',
      [
        {
          kind: 'target_failures',
          count: 18,
          targetPx: 44,
          medianPx: 20,
        } as TraceEvidence,
      ],
      { mode: 'offer' },
    );
    expect(offerQuestion(measured).reason).toBe(
      `Most buttons here are 20${NBSP}px.`,
    );
    expect(
      explainChange(change(trace('target_size', [], { level: 2 }))).detail,
    ).toBe(
      `3 links and buttons here were smaller than 44${NBSP}px. WebAble grew clickable areas up to 44${NBSP}px where there’s room. Nothing moved.`,
    );
  });

  it('asks about long lines with the fit as a ceiling', () => {
    const t = trace(
      'line_length',
      [{ kind: 'long_lines', lineCh: 110, maxCh: 70 }],
      { mode: 'offer' },
    );
    expect(offerQuestion(t)).toEqual({
      question: 'Keep lines shorter here?',
      reason: `They run to 110${NBSP}characters. Your fit is 70 or fewer.`,
    });
  });

  it('takes every title from the glossary', () => {
    for (const op of OP_IDS) expect(OP_CATALOG[op].label).toBe(OP_LABELS[op]);
    expect(OP_LABELS.dim_distractions).toBe('Busy areas');
  });

  it('explains a change the checks undid', () => {
    const t = trace('line_spacing', [
      { kind: 'tight_lines', lineHeight: 1.2, target: 1.6 },
    ]);
    expect(
      explainUndone(
        change(t, { status: 'undone_by_checks', vcode: 'overlap' }),
      ),
    ).toEqual({
      title: 'Line spacing',
      detail:
        'Line spacing was undone. It made text overlap here, so WebAble put it back.',
    });
    expect(
      explainChange(change(t, { status: 'undone_by_checks', vcode: 'overlap' }))
        .detail,
    ).toBe(
      'Line spacing was undone. It made text overlap here, so WebAble put it back.',
    );
    expect(
      explainUndone(
        change(trace('target_size', []), {
          status: 'undone_by_checks',
          vcode: 'timeout',
        }),
      ).detail,
    ).toBe(
      'Larger click targets were undone. This page took too long to check, so WebAble put them back.',
    );
  });

  it('says page analysis, never AI, for analysed regions', () => {
    const t = trace('dim_distractions', [
      {
        kind: 'region_role',
        role: 'recommendations',
        by: 'page_analysis',
        label: 'clear',
      },
    ]);
    const detail = explainChange(change(t, { count: 1 })).detail;
    expect(detail).toBe(
      'WebAble softened 1 area that looks like links to other pages (page analysis: clear). Hover or tab into it to bring it back.',
    );
    const rule = trace('dim_distractions', [
      { kind: 'region_role', role: 'promo_ad', by: 'rule' },
    ]);
    expect(explainChange(change(rule, { count: 2 })).detail).toContain(
      'look like ads.',
    );
    expect(offerQuestion(t).reason).toBe(
      'Page analysis found 1 area that looks like links to other pages.',
    );
  });

  it('names the authority behind a change', () => {
    const system = trace(
      'calm_motion',
      [
        { kind: 'motion_sources', count: 4 },
        { kind: 'learned', note: 'system_setting' },
      ],
      { source: 'system' },
    );
    expect(explainChange(change(system)).detail).toBe(
      '4 things were moving on this page. WebAble stopped them. Your device asks for less motion.',
    );
    const pinned = trace(
      'reading_guide',
      [{ kind: 'learned', note: 'site_pin' }],
      { source: 'pinned' },
    );
    expect(explainChange(change(pinned)).detail).toBe(
      'WebAble shades the page above and below the line you are reading. You chose this for this site.',
    );
  });

  it('prefers measured fit values and formats units', () => {
    expect(formatFit('13', 'px')).toBe(`13${NBSP}px`);
    expect(formatFit('13px', 'px')).toBe(`13${NBSP}px`);
    expect(formatFit('125%', '%')).toBe('125%');
    expect(formatFit('70ch', 'ch')).toBe(`70${NBSP}characters`);
    expect(formatFit('1.6', '')).toBe('1.6');
    expect(formatFit(undefined, 'px')).toBeNull();
    expect(formatLevel('contrast', 1)).toBe('7:1');
    expect(formatLevel('page_zoom', 1)).toBe('125%');
    expect(formatLevel('line_length', 1)).toBe(`70${NBSP}characters`);
    expect(formatLevel('steady_clicks', 1)).toBe(`300${NBSP}ms`);
  });

  it('handles changes that were not needed or could not run', () => {
    const t = trace('target_size', []);
    expect(explainChange(change(t, { status: 'not_needed' })).detail).toBe(
      'Larger click targets were not needed here. Nothing changed.',
    );
    expect(explainChange(change(t, { status: 'error' })).detail).toBe(
      'WebAble could not make this change here. The page is as the site made it.',
    );
  });
});

describe('every op, every status, every check', () => {
  const p = focusProfile();
  p.motor.input = 'keyboard';
  const input = makeInput({
    profile: p,
    signals: articleSignals({ sticky: { bars: 1, topBandPx: 220 } }),
    patch: {
      verdicts: {
        'k-rail': {
          key: 'k-rail',
          role: 'recommendations',
          label: 'likely',
          protected: false,
          source: 'page_analysis',
          pEligible: 0.8,
        },
      },
      friction: {
        text_floor: 4,
        target_size: 3,
        line_spacing: 2,
        calm_motion: 3,
      },
    },
  });
  const traces = planWithTraces(input).traces;
  const sources: DecisionSource[] = [
    'profile',
    'pinned',
    'system',
    'friction',
    'manual',
    'none',
  ];

  it.each(OP_IDS)('renders compliant copy for %s', (op) => {
    const measured = traces.find((t) => t.op === op)!;
    expect(measured).toBeDefined();
    const variants: DecisionTrace[] = [
      { ...measured, mode: 'auto' },
      { ...measured, mode: 'offer', evidence: [] },
      ...sources.map((source) => ({ ...measured, source })),
      ...OP_CATALOG[op].levels.map((_, level) => ({ ...measured, level })),
    ];
    for (const t of variants) {
      for (const count of [0, 1, 7]) {
        const e = explainChange(change(t, { count }));
        expect(e.title).toBe(OP_CATALOG[op].label);
        checkCopy(e.detail);
        checkCopy(
          explainChange(change(t, { count, status: 'not_needed' })).detail,
        );
        checkCopy(explainChange(change(t, { count, status: 'error' })).detail);
        checkCopy(
          explainChange(
            change(t, { count, fit: { before: '12', after: '20 px' } }),
          ).detail,
        );
      }
      const q = offerQuestion(t);
      checkCopy(q.question);
      checkCopy(q.reason);
      expect(q.question.endsWith('?')).toBe(true);
      for (const vcode of [...VERIFY_CODES, undefined]) {
        const u = explainUndone(
          change(t, { status: 'undone_by_checks', vcode }),
        );
        expect(u.title).toBe(OP_CATALOG[op].label);
        checkCopy(u.detail);
        expect(u.detail).toMatch(/undone\./);
        expect(u.detail).toMatch(/so WebAble put (it|them) back\.$/);
      }
    }
  });

  it('never invents numbers: without evidence or fit it says less', () => {
    for (const op of OP_IDS) {
      const bare = explainChange(change(trace(op, []), { count: 0 })).detail;
      const digits = bare.match(/\d+(?:\.\d+)?/g) ?? [];
      const levelText = formatLevel(op, 0);
      for (const d of digits)
        expect(
          levelText.includes(d) || bare.includes('%'),
          `${op}: ${bare}`,
        ).toBe(true);
    }
  });
});

describe('page scale and text floor (docs/10 §5.1-5.2)', () => {
  const scaled = (zoom: number, k: number, floorPx: number, beforePx: number) =>
    trace(
      'page_zoom',
      [
        { kind: 'page_scale', zoom, k },
        { kind: 'small_text', share: 0.99, floorPx, beforePx },
      ],
      { level: OP_CATALOG.page_zoom.levels.indexOf(zoom) },
    );

  it('says the page scale reaches the person’s size when it does', () => {
    expect(explainChange(change(scaled(1.5, 1.5, 21, 14))).detail).toBe(
      `Most text here was 14${NBSP}px. WebAble scaled this page to 150% so its text reaches your 21${NBSP}px.`,
    );
    // 19 px at 125% is 23.75 px: it reaches 24.
    expect(explainChange(change(scaled(1.25, 1.263, 24, 19))).detail).toBe(
      `Most text here was 19${NBSP}px. WebAble scaled this page to 125% so its text reaches your 24${NBSP}px.`,
    );
  });

  it('says less when the text floor carries the rest, or the guard stepped the scale down', () => {
    expect(explainChange(change(scaled(1.5, 2, 28, 14))).detail).toBe(
      `Most text here was 14${NBSP}px. WebAble scaled this page to 150%, so everything grows together.`,
    );
    const stepped = change(scaled(1.5, 1.5, 21, 14), {
      fit: { before: '100%', after: '125%' },
    });
    expect(explainChange(stepped).detail).toBe(
      `Most text here was 14${NBSP}px. WebAble scaled this page to 125%, so everything grows together.`,
    );
    expect(
      explainChange(change(trace('page_zoom', [], { level: 2 }))).detail,
    ).toBe(
      'Text across this page was small. WebAble scaled this page to 150%, so everything grows together.',
    );
  });

  it('explains a text floor at the page scale in effective px', () => {
    const t = trace(
      'text_floor',
      [
        { kind: 'small_text', share: 0.99, floorPx: 28, beforePx: 21 },
        { kind: 'page_scale', zoom: 1.5, k: 2 },
      ],
      { level: 5 },
    );
    expect(explainChange(change(t)).detail).toBe(
      `With this page at 150%, most text here was 21${NBSP}px. WebAble raised it to your 28${NBSP}px.`,
    );
    expect(offerQuestion({ ...t, mode: 'offer' })).toEqual({
      question: 'Text on this page is small. Make it larger here?',
      reason: `With this page at 150%, most text here is 21${NBSP}px. Your fit is 28${NBSP}px.`,
    });
    expect(
      offerQuestion({ ...scaled(1.25, 1.3, 21, 16), mode: 'offer' }),
    ).toEqual({
      question: 'Text on this page is small. Zoom this page to 125%?',
      reason: `Most text here is 16${NBSP}px. Your fit is 21${NBSP}px.`,
    });
  });

  it('renders compliant copy for the planned page scale and text floor of every persona', () => {
    for (const px of [18, 21, 24, 28, 36]) {
      for (const signals of [
        govukSignals(),
        wikipediaSignals(),
        youtubeSignals(),
      ]) {
        const profile = largeTextProfile(px);
        const { traces } = planWithTraces(
          makeInput({
            profile,
            signals,
            patch: { triage: triageFor(profile, signals) },
          }),
        );
        for (const op of ['page_zoom', 'text_floor'] as const) {
          const t = traces.find((x) => x.op === op)!;
          for (const count of [0, 1, 7]) {
            checkCopy(explainChange(change(t, { count })).detail);
            checkCopy(
              explainChange(
                change(t, { count, fit: { before: '100%', after: '150%' } }),
              ).detail,
            );
          }
          const q = offerQuestion({ ...t, mode: 'offer' });
          checkCopy(q.question);
          checkCopy(q.reason);
        }
      }
    }
  });
});

describe('the triage line', () => {
  const verdict = (
    reasons: TriageReason[],
    kind: TriageVerdict['verdict'] = 'tailor',
  ): TriageVerdict => ({
    version: TRIAGE_VERSION,
    verdict: kind,
    k: 1.4,
    zoom: 1.25,
    zMax: 1.6,
    residual: 1.12,
    needs: {
      text: 'tailor',
      targets: 'fits',
      clutter: 'fits',
      occlusion: 'fits',
      contrast: 'fits',
      motion: 'fits',
    },
    reasons,
    representable: true,
    blockers: [],
  });

  it('renders the popup’s one line from the structured reasons', () => {
    expect(triageLine(verdict([], 'fits'))).toBe('This page already fits you.');
    expect(
      triageLine(
        verdict([
          { kind: 'small_text', k: 1.4 },
          { kind: 'crowded_targets', share: 0.4 },
        ]),
      ),
    ).toBe('Small text and crowded buttons for your fit.');
    expect(
      triageLine(
        verdict([
          { kind: 'small_text', k: 1.9 },
          { kind: 'cant_stretch', k: 1.9, zMax: 1.6 },
          { kind: 'small_targets', share: 0.6, targetPx: 56 },
          { kind: 'crowded_targets', share: 0.5 },
          { kind: 'busy', percentile: 94 },
          { kind: 'motion', count: 3 },
        ]),
      ),
    ).toBe(
      'Small text, small buttons close together and a busy layout for your fit.',
    );
    expect(triageLine(verdict([{ kind: 'covered', share: 0.35 }]))).toBe(
      'Bars that cover the page for your fit.',
    );
  });

  it('is compliant copy for every persona and page', () => {
    const personas = [
      largeTextProfile(18),
      largeTextProfile(36),
      largeTargetProfile(56),
      highDistractionProfile(),
    ];
    const pages = [govukSignals(), wikipediaSignals(), youtubeSignals()];
    const lines = new Set<string>();
    for (const p of personas)
      for (const signals of pages) {
        const line = triageLine(triageFor(p, signals));
        checkCopy(line);
        expect(line.endsWith('.')).toBe(true);
        lines.add(line);
      }
    expect(lines).toContain('This page already fits you.');
    expect(lines.size).toBeGreaterThan(3);
  });
});
