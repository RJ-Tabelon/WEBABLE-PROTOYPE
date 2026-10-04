import { OP_CATALOG, type OpId } from '../ops/catalog';
import { OP_LABELS } from './glossary';
import type { RegionRole } from '../page/types';
import type {
  AppliedChange,
  DecisionTrace,
  TraceEvidence,
  VerifyCode,
} from '../policy/types';

/**
 * "Why this changed": deterministic templates rendered from the DecisionTrace.
 * Faithful by construction. Never names a condition, never claims conformance,
 * says "page analysis" (not "AI decided"), always implies undo is available.
 *
 * Voice (design-final.md 13): calm, exact, short; what changed, by how much,
 * then how to get it back. Numbers are digits with units joined by a no-break
 * space ("18 px"). Only real measured values are used; when a value is
 * missing the sentence says less rather than inventing one.
 */
export interface Explanation {
  /** e.g. "Text size" */
  title: string;
  /** e.g. "Most text here was 13 px. WebAble raised it to your 18 px." */
  detail: string;
}

/** No-break space between a number and its unit. */
export const NBSP = ' ';

type EvidenceOf<K extends TraceEvidence['kind']> = Extract<
  TraceEvidence,
  { kind: K }
>;

function find<K extends TraceEvidence['kind']>(
  trace: DecisionTrace,
  kind: K,
): EvidenceOf<K> | undefined {
  return trace.evidence.find((e): e is EvidenceOf<K> => e.kind === kind);
}
function findAll<K extends TraceEvidence['kind']>(
  trace: DecisionTrace,
  kind: K,
): EvidenceOf<K>[] {
  return trace.evidence.filter((e): e is EvidenceOf<K> => e.kind === kind);
}
const hasNote = (trace: DecisionTrace, note: EvidenceOf<'learned'>['note']) =>
  trace.evidence.some((e) => e.kind === 'learned' && e.note === note);

const num = (n: number): string => String(Math.round(n * 100) / 100);
const px = (n: number): string => `${Math.round(n)}${NBSP}px`;
const ms = (n: number): string => `${Math.round(n)}${NBSP}ms`;
const plural = (n: number, one: string, many: string): string =>
  n === 1 ? one : many;

/** The measured median size of the page's links and buttons, when the evidence carries one. */
function medianPx(ev: EvidenceOf<'target_failures'>): number | null {
  const median: unknown = 'medianPx' in ev ? ev.medianPx : undefined;
  return typeof median === 'number' && median > 0 ? median : null;
}

/** A level's value in copy form, e.g. "18 px", "125%", "1.6", "70 characters", "7:1". */
export function formatLevel(op: OpId, level: number): string {
  const def = OP_CATALOG[op];
  const value =
    def.levels[
      Math.max(0, Math.min(def.levels.length - 1, Math.round(level)))
    ] ??
    def.levels[0] ??
    0;
  switch (def.unit) {
    case 'px':
      return px(value);
    case 'x':
      return `${Math.round(value * 100)}%`;
    case 'ratio':
      return op === 'contrast' ? `${num(value)}:1` : num(value);
    case 'ch':
      return `${Math.round(value)}${NBSP}characters`;
    case 'ms':
      return ms(value);
    case 'opacity':
      return `${Math.round((1 - value) * 100)}%`;
    case 'none':
      return 'on';
  }
}

/**
 * Normalise a measured fit value ("13", "13px", "13 px", "125%", "1.6", "70ch")
 * into copy form with a no-break space before word units. `unit` supplies the
 * unit when the string is a bare number.
 */
export function formatFit(
  raw: string | undefined,
  unit: 'px' | '%' | 'ch' | 'ms' | ':1' | '',
): string | null {
  if (raw === undefined) return null;
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*([a-z%:0-9]*)\s*$/i.exec(raw);
  if (!match)
    return raw.trim() === ''
      ? null
      : raw.trim().replace(/(\d)\s+(px|ms|characters|ch)\b/g, `$1${NBSP}$2`);
  const value = match[1]!;
  const given = (match[2] ?? '').toLowerCase();
  const u = given === '' ? unit : given === 'characters' ? 'ch' : given;
  switch (u) {
    case 'px':
      return `${value}${NBSP}px`;
    case 'ms':
      return `${value}${NBSP}ms`;
    case 'ch':
      return `${value}${NBSP}characters`;
    case '%':
      return `${value}%`;
    case ':1':
      return `${value}:1`;
    default:
      return value;
  }
}

const fitNumber = (raw: string | undefined): number | null => {
  if (raw === undefined) return null;
  const m = /-?\d+(?:\.\d+)?/.exec(raw);
  return m ? Number(m[0]) : null;
};

/** Subject for sentences about a change, with number agreement. */
const SUBJECT: Readonly<Record<OpId, { text: string; plural: boolean }>> = {
  text_floor: { text: 'Larger text', plural: false },
  page_zoom: { text: 'Page zoom', plural: false },
  line_spacing: { text: 'Line spacing', plural: false },
  line_length: { text: 'Shorter lines', plural: true },
  contrast: { text: 'Darker text', plural: false },
  focus_outline: { text: 'The focus outline', plural: false },
  target_size: { text: 'Larger click targets', plural: true },
  target_spacing: { text: 'Extra space between controls', plural: false },
  steady_clicks: { text: 'Steady clicks', plural: true },
  menu_grace: { text: 'Keeping menus open', plural: false },
  calm_motion: { text: 'Stopping motion', plural: false },
  pause_media: { text: 'Pausing autoplay', plural: false },
  dim_distractions: { text: 'Softening busy areas', plural: false },
  focus_view: { text: 'Focus view', plural: false },
  unpin_bars: { text: 'Unpinning the top bar', plural: false },
  reading_guide: { text: 'The reading guide', plural: false },
};

const ROLE_NOUN: Readonly<Record<RegionRole, { one: string; many: string }>> = {
  promo_ad: { one: 'an ad', many: 'ads' },
  recommendations: {
    one: 'links to other pages',
    many: 'links to other pages',
  },
  chat_widget: { one: 'a chat button', many: 'chat buttons' },
  main_content: { one: 'the main content', many: 'the main content' },
  navigation: { one: 'a menu', many: 'menus' },
  consent_banner: { one: 'a cookie notice', many: 'cookie notices' },
  help_contact: { one: 'help links', many: 'help links' },
  form: { one: 'a form', many: 'forms' },
  footer: { one: 'the footer', many: 'the footer' },
  other: { one: 'something else', many: 'other things' },
};

function joinWords(items: string[]): string {
  const unique = [...new Set(items)];
  if (unique.length <= 1) return unique[0] ?? '';
  return `${unique.slice(0, -1).join(', ')} or ${unique[unique.length - 1]!}`;
}

/** Why the source put this op on the table, in one short sentence (or nothing for the profile). */
function sourceSentence(trace: DecisionTrace): string | null {
  if (trace.source === 'system' || hasNote(trace, 'system_setting')) {
    return trace.op === 'calm_motion' || trace.op === 'pause_media'
      ? 'Your device asks for less motion.'
      : 'Your device settings ask for this.';
  }
  if (trace.source === 'pinned') {
    return hasNote(trace, 'site_pin')
      ? 'You chose this for this site.'
      : 'You chose to always do this.';
  }
  return null;
}

function regionPhrase(
  trace: DecisionTrace,
  count: number,
): { what: string; analysis: string } {
  const roles = findAll(trace, 'region_role').filter(
    (e) =>
      e.role === 'promo_ad' ||
      e.role === 'recommendations' ||
      e.role === 'chat_widget',
  );
  const many = count !== 1;
  const what =
    joinWords(
      roles.map((e) => (many ? ROLE_NOUN[e.role].many : ROLE_NOUN[e.role].one)),
    ) || 'ads or side panels';
  const analysed = roles.find((e) => e.by === 'page_analysis');
  const analysis = analysed?.label ? ` (page analysis: ${analysed.label})` : '';
  return { what, analysis };
}

function appliedDetail(change: AppliedChange): string {
  const { trace } = change;
  const op = change.op;
  const after = (unit: Parameters<typeof formatFit>[1]) =>
    formatFit(change.fit?.after, unit);
  const before = (unit: Parameters<typeof formatFit>[1]) =>
    formatFit(change.fit?.before, unit);

  switch (op) {
    case 'text_floor': {
      const ev = find(trace, 'small_text');
      const to =
        after('px') ?? (ev ? px(ev.floorPx) : formatLevel(op, change.level));
      const from =
        before('px') ?? (ev?.beforePx != null ? px(ev.beforePx) : null);
      const lead =
        ev && ev.share >= 0.5 ? 'Most text' : ev ? 'Some text' : 'Text';
      return from
        ? `${lead} here was ${from}. WebAble raised it to your ${to}.`
        : `Some text here was smaller than ${to}. WebAble raised it to your ${to}.`;
    }
    case 'page_zoom': {
      const to = after('%') ?? formatLevel(op, change.level);
      return `Text across this page was small. WebAble zoomed the page to ${to}, so everything grows together.`;
    }
    case 'line_spacing': {
      const ev = find(trace, 'tight_lines');
      const from = before('') ?? (ev ? num(ev.lineHeight) : null);
      const to =
        after('') ?? (ev ? num(ev.target) : formatLevel(op, change.level));
      return from
        ? `Lines here were close together (${from}). WebAble spaced them to ${to}.`
        : `WebAble spaced lines here to ${to}.`;
    }
    case 'line_length': {
      const ev = find(trace, 'long_lines');
      const from = fitNumber(change.fit?.before) ?? ev?.lineCh ?? null;
      const to =
        fitNumber(change.fit?.after) ??
        ev?.maxCh ??
        OP_CATALOG[op].levels[change.level] ??
        null;
      if (from !== null && to !== null) {
        return `Lines here ran to ${Math.round(from)}${NBSP}characters. WebAble kept them to ${Math.round(to)}.`;
      }
      return 'Lines here were long. WebAble kept them to a comfortable width.';
    }
    case 'contrast': {
      const ev = find(trace, 'contrast_failures');
      const count = ev?.count ?? change.count;
      const target =
        ev?.targetRatio ?? OP_CATALOG.contrast.levels[change.level] ?? 4.5;
      const goal =
        target >= 21 ? 'the strongest contrast' : `at least ${num(target)}:1`;
      const lead =
        count > 0
          ? `${count} ${plural(count, 'piece', 'pieces')} of text here ${plural(count, 'was', 'were')} faint. `
          : '';
      return `${lead}WebAble raised ${count === 1 ? 'its' : 'their'} contrast to ${goal}. Colours and layout stay the same.`;
    }
    case 'focus_outline':
      return 'WebAble shows a clear outline around whatever the keyboard is on. Nothing else changes.';
    case 'target_size': {
      const ev = find(trace, 'target_failures');
      const size =
        after('px') ?? (ev ? px(ev.targetPx) : formatLevel(op, change.level));
      const count = ev?.count ?? change.count;
      const lead =
        count > 0
          ? `${count} ${plural(count, 'link or button', 'links and buttons')} here ${plural(count, 'was', 'were')} smaller than ${size}. `
          : '';
      return `${lead}WebAble grew clickable areas up to ${size} where there’s room. Nothing moved.`;
    }
    case 'target_spacing': {
      const ev = find(trace, 'crowded_targets');
      const room = after('px') ?? formatLevel(op, change.level);
      const lead = ev
        ? `${ev.count} ${plural(ev.count, 'control', 'controls')} here sat very close together. `
        : '';
      return `${lead}WebAble added ${room} of room between them.`;
    }
    case 'steady_clicks':
      return `A click now counts on the button you pressed, even if the pointer slips a little within ${after('ms') ?? formatLevel(op, change.level)}.`;
    case 'menu_grace': {
      const ev = find(trace, 'hover_menus');
      const lead = ev
        ? `${ev.count} ${plural(ev.count, 'menu', 'menus')} here ${plural(ev.count, 'closes', 'close')} as soon as the pointer drifts off. `
        : '';
      return `${lead}WebAble keeps ${ev?.count === 1 ? 'it' : 'them'} open for ${after('ms') ?? formatLevel(op, change.level)}.`;
    }
    case 'calm_motion': {
      const ev = find(trace, 'motion_sources');
      const count = ev?.count ?? change.count;
      return count > 0
        ? `${count} ${plural(count, 'thing was', 'things were')} moving on this page. WebAble stopped ${count === 1 ? 'it' : 'them'}.`
        : 'WebAble stopped animation on this page and made transitions instant.';
    }
    case 'pause_media': {
      const ev = find(trace, 'autoplay_media');
      const count = ev?.count ?? change.count;
      return count > 0
        ? `${count} ${plural(count, 'video or animation', 'videos or animations')} started on ${plural(count, 'its', 'their')} own. WebAble paused ${count === 1 ? 'it' : 'them'}. You can play ${count === 1 ? 'it' : 'them'} again.`
        : 'WebAble paused media that started on its own. You can play it again.';
    }
    case 'dim_distractions': {
      // The applied count is the real number of softened regions; the trace lists the candidates.
      const regions =
        change.count > 0 ? change.count : findAll(trace, 'region_role').length;
      const { what, analysis } = regionPhrase(trace, regions);
      if (regions === 0) {
        return `WebAble softened areas that look like ${what}${analysis}. Hover or tab into them to bring them back.`;
      }
      const one = regions === 1;
      return `WebAble softened ${regions} ${plural(regions, 'area', 'areas')} that ${plural(regions, 'looks', 'look')} like ${what}${analysis}. Hover or tab into ${one ? 'it' : 'them'} to bring ${one ? 'it' : 'them'} back.`;
    }
    case 'focus_view':
      return 'WebAble softened everything except the main content. Everything else still works as before.';
    case 'unpin_bars': {
      const ev = find(trace, 'sticky_bars');
      return ev && ev.heightPx > 0
        ? `A bar pinned to the top took ${px(ev.heightPx)} of the screen. WebAble lets it scroll away with the page.`
        : 'WebAble lets the bar pinned to the top scroll away with the page.';
    }
    case 'reading_guide':
      return 'WebAble shades the page above and below the line you are reading.';
  }
}

/** "Why this changed" for one change the content script reported. */
export function explainChange(change: AppliedChange): Explanation {
  const title = OP_LABELS[change.op];
  if (change.status === 'undone_by_checks') return explainUndone(change);
  const subject = SUBJECT[change.op];
  if (change.status === 'not_needed') {
    return {
      title,
      detail: `${subject.text} ${subject.plural ? 'were' : 'was'} not needed here. Nothing changed.`,
    };
  }
  if (change.status === 'error') {
    return {
      title,
      detail: `WebAble could not make this change here. The page is as the site made it.`,
    };
  }
  const source = sourceSentence(change.trace);
  const detail = appliedDetail(change);
  return { title, detail: source ? `${detail} ${source}` : detail };
}

const FRICTION_REASON: Readonly<
  Record<EvidenceOf<'friction'>['signal'], string>
> = {
  misclick_burst: 'You clicked just next to a few buttons in the last minute.',
  rage_click: 'You clicked the same spot several times.',
  zoom_in: 'You zoomed in on this page.',
  scroll_reversal: 'You scrolled back over the same lines a few times.',
};

/** The question shown for an offer: "Buttons on this page are small. Make them bigger here?" */
export function offerQuestion(trace: DecisionTrace): {
  question: string;
  reason: string;
} {
  const friction = find(trace, 'friction');
  const why = (measured: string): string =>
    friction ? FRICTION_REASON[friction.signal] : measured;
  const level = formatLevel(trace.op, trace.level);

  switch (trace.op) {
    case 'text_floor': {
      const ev = find(trace, 'small_text');
      const measured =
        ev?.beforePx != null
          ? `Most text here is ${px(ev.beforePx)}. Your fit is ${px(ev.floorPx)}.`
          : `Your fit is ${level}.`;
      return {
        question: 'Text on this page is small. Make it larger here?',
        reason: why(measured),
      };
    }
    case 'page_zoom': {
      const ev = find(trace, 'small_text');
      const measured =
        ev?.beforePx != null
          ? `Most text here is ${px(ev.beforePx)}. Your fit is ${px(ev.floorPx)}.`
          : 'Text across this page is small.';
      return {
        question: `Text on this page is small. Zoom this page to ${level}?`,
        reason: why(measured),
      };
    }
    case 'line_spacing': {
      const ev = find(trace, 'tight_lines');
      const measured = ev
        ? `Line spacing here is ${num(ev.lineHeight)}. Your fit is ${num(ev.target)}.`
        : `Your fit is ${level}.`;
      return {
        question: 'Lines here are close together. Add space between them?',
        reason: why(measured),
      };
    }
    case 'line_length': {
      const ev = find(trace, 'long_lines');
      const measured = ev
        ? `They run to ${ev.lineCh}${NBSP}characters. Your fit is ${ev.maxCh} or fewer.`
        : 'Lines here are long.';
      return {
        question: 'Keep lines shorter here?',
        reason: why(measured),
      };
    }
    case 'contrast': {
      const ev = find(trace, 'contrast_failures');
      const measured = ev
        ? `${ev.count} ${plural(ev.count, 'piece', 'pieces')} of text here ${plural(ev.count, 'is', 'are')} below ${ev.targetRatio >= 21 ? 'your contrast' : `${num(ev.targetRatio)}:1`}.`
        : 'Some text here is faint.';
      return {
        question: 'Some text here is faint. Make it clearer?',
        reason: why(measured),
      };
    }
    case 'focus_outline':
      return {
        question: 'Show a clear outline around what the keyboard is on?',
        reason: why('It shows where you are when you use the keyboard.'),
      };
    case 'target_size': {
      const ev = find(trace, 'target_failures');
      const median = ev ? medianPx(ev) : null;
      const measured = median
        ? `Most buttons here are ${px(median)}.`
        : ev
          ? `${ev.count} ${plural(ev.count, 'link or button', 'links and buttons')} here ${plural(ev.count, 'is', 'are')} smaller than ${px(ev.targetPx)}.`
          : 'Some links and buttons here are small.';
      return {
        question: 'Buttons on this page are small. Make them bigger here?',
        reason: why(measured),
      };
    }
    case 'target_spacing': {
      const ev = find(trace, 'crowded_targets');
      const measured = ev
        ? `${ev.count} ${plural(ev.count, 'control sits', 'controls sit')} very close to ${plural(ev.count, 'another', 'each other')}.`
        : 'Some controls here sit very close together.';
      return {
        question: 'Buttons here sit close together. Add space between them?',
        reason: why(measured),
      };
    }
    case 'steady_clicks': {
      const ev = find(trace, 'target_failures');
      const measured = ev
        ? `${ev.count} ${plural(ev.count, 'button here is', 'buttons here are')} small.`
        : 'It keeps a click on the button you pressed.';
      return {
        question: 'Count a click even if the pointer slips a little?',
        reason: why(measured),
      };
    }
    case 'menu_grace': {
      const ev = find(trace, 'hover_menus');
      const measured = ev
        ? `${ev.count} ${plural(ev.count, 'menu here opens', 'menus here open')} when you point at ${plural(ev.count, 'it', 'them')}.`
        : 'Menus here open when you point at them.';
      return {
        question: 'Menus here close quickly. Keep them open longer?',
        reason: why(measured),
      };
    }
    case 'calm_motion': {
      const ev = find(trace, 'motion_sources');
      const measured = ev
        ? `${ev.count} ${plural(ev.count, 'thing is', 'things are')} moving here.`
        : 'Things are moving here.';
      return {
        question: 'Things are moving on this page. Stop them?',
        reason: why(measured),
      };
    }
    case 'pause_media': {
      const ev = find(trace, 'autoplay_media');
      const measured = ev
        ? `${ev.count} ${plural(ev.count, 'video or animation', 'videos or animations')} started on ${plural(ev.count, 'its', 'their')} own.`
        : 'Something here started playing on its own.';
      return {
        question: 'Videos here play on their own. Pause them?',
        reason: why(measured),
      };
    }
    case 'dim_distractions': {
      const roles = findAll(trace, 'region_role');
      const count = Math.max(1, roles.length);
      const { what, analysis } = regionPhrase(trace, count);
      const measured = analysis
        ? `Page analysis found ${count} ${plural(count, 'area', 'areas')} that ${plural(count, 'looks', 'look')} like ${what}.`
        : `${count} ${plural(count, 'area', 'areas')} here ${plural(count, 'looks', 'look')} like ${what}.`;
      return {
        question: 'This page has busy areas. Soften them?',
        reason: why(measured),
      };
    }
    case 'focus_view':
      return {
        question: 'Soften everything except the main content?',
        reason: why('There is a lot around the main content here.'),
      };
    case 'unpin_bars': {
      const ev = find(trace, 'sticky_bars');
      const measured =
        ev && ev.heightPx > 0
          ? `It takes ${px(ev.heightPx)} of the screen.`
          : 'It takes space from the page.';
      return {
        question: 'A bar stays pinned to the top. Let it scroll away?',
        reason: why(measured),
      };
    }
    case 'reading_guide':
      return {
        question: 'Shade the page above and below the line you are reading?',
        reason: why('This page has a lot of text.'),
      };
  }
}

const UNDONE_REASON: Readonly<Record<VerifyCode, string>> = {
  clip: 'cut off some text here',
  overlap: 'made text overlap here',
  overflow: 'pushed content past the edge of the page',
  contrast_drop: 'made some text harder to read',
  focus_hidden: 'hid the keyboard outline here',
  control_collapsed: 'squeezed a control too small to use',
  layout_shift: 'made the page jump',
  focus_lost: 'moved your place on the page',
  timeout: '',
  apply_error: 'did not work on this page',
};

/** Neutral copy for a change the checks undid: "Line spacing was undone. It made text overlap here…" */
export function explainUndone(change: AppliedChange): Explanation {
  const title = OP_LABELS[change.op];
  const subject = SUBJECT[change.op];
  const verb = subject.plural ? 'were' : 'was';
  const object = subject.plural ? 'them' : 'it';
  const lead = `${subject.text} ${verb} undone.`;
  if (change.vcode === 'timeout') {
    return {
      title,
      detail: `${lead} This page took too long to check, so WebAble put ${object} back.`,
    };
  }
  const clause =
    UNDONE_REASON[change.vcode ?? 'apply_error'] || UNDONE_REASON.apply_error;
  const pronoun = subject.plural ? 'They' : 'It';
  return {
    title,
    detail: `${lead} ${pronoun} ${clause}, so WebAble put ${object} back.`,
  };
}
