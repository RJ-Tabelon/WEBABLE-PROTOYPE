// Owner: D (round 9). What the Jev Lens says about the paragraphs WebAble read for this person: the words on each
// paragraph's tag, the sheet's summary line, and where the tags sit (pure, so it is tested without a page).
// The only place these probabilities are shown; the word is always "Jev's probability".
import type { RewordKind } from '@webable/core';
import type { EngineState, RewordItem } from '../../contracts';
import { overlaps, type Rect } from './place';
import { fmtP } from './words';

export const KIND_WORDS: Record<RewordKind, string> = {
  plain: 'plainer words',
  list: 'steps or a list',
  shorter: 'shorter',
  point_first: 'main point first',
};

/** Why a rewrite was not used, in plain words ('' when the reason is unknown). */
const REASON_WORDS: Record<string, string> = {
  numbers: 'a number changed',
  conditions: 'a condition changed',
  links: 'a link went missing',
  dropped: 'a fact went missing',
  added: 'it added something',
  late: 'it came too late',
  layout: 'it did not fit the page',
  llm_unavailable: 'no rewrite came back',
  check_unavailable: 'it could not be checked',
};

export type ParaTone = 'new' | 'waiting' | 'checked' | 'original' | 'kept';

export interface ParaFace {
  /** The tag's first line and its number. */
  top: string;
  num: string;
  /** What WebAble did with it: "plainer words · rewritten". */
  sub: string;
  /** Why a checked rewrite was not used ("a number changed"), or ''. */
  why: string;
  /** The whole sentence, for the tooltip and screen readers. */
  say: string;
  tone: ParaTone;
}

export function paraFace(it: RewordItem): ParaFace {
  const num = fmtP(it.need);
  const kind = it.pick ? KIND_WORDS[it.pick] : null;
  const why = it.reason ? REASON_WORDS[it.reason] ?? '' : '';
  let tone: ParaTone = 'kept';
  let did = 'kept';
  if (kind && it.state === 'rewritten') [tone, did] = ['new', 'rewritten'];
  else if (kind && it.state === 'waiting') [tone, did] = ['waiting', 'being rewritten'];
  else if (kind && it.state === 'failed') [tone, did] = ['checked', 'checked: kept the original'];
  else if (kind && it.state === 'original') [tone, did] = ['original', "rewritten; showing the page's words"];
  const sub = kind ? `${kind} · ${did}` : did;
  const shown = tone === 'checked' ? why : '';
  return {
    top: 'Harder than it needs to be for you',
    num,
    sub,
    why: shown,
    say: `Jev's probability this is harder than it needs to be for you: ${num} · ${sub}${shown ? ` (${shown})` : ''}`,
    tone,
  };
}

export interface ParaCounts { read: number; picked: number; rewritten: number; waiting: number; failed: number }

export function paraCounts(items: RewordItem[]): ParaCounts {
  return {
    read: items.length,
    picked: items.filter((i) => i.pick !== null).length,
    rewritten: items.filter((i) => i.state === 'rewritten' || i.state === 'original').length,
    waiting: items.filter((i) => i.state === 'waiting').length,
    failed: items.filter((i) => i.state === 'failed').length,
  };
}

/** "Jev read 14 for you, picked 5, 5 rewritten, all checked"; null when WebAble is not reading paragraphs here. */
export function paraSummary(r: EngineState['reword'] | undefined): string | null {
  if (!r || r.status === 'off') return null;
  const c = paraCounts(r.items ?? []);
  if (r.status === 'error' && c.read === 0) return "Couldn't read the paragraphs for you right now";
  if (c.read === 0) return r.status === 'scoring' ? 'Jev is reading the paragraphs for you…' : null;
  if (c.picked === 0) return `Jev read ${c.read} for you; none needed changing`;
  const parts = [`Jev read ${c.read} for you`, `picked ${c.picked}`, `${c.rewritten} rewritten`];
  if (c.waiting) parts.push(`${c.waiting} being written`);
  if (c.failed) parts.push(`${c.failed} kept the page's words after the check`);
  else if (!c.waiting && c.rewritten) parts.push('all checked');
  return parts.join(', ');
}

/**
 * Where each paragraph's tag sits: in the gutter left of the paragraph, level with its top; where there is no room,
 * just above it. Tags never overlap each other or `avoid` (our header, sheet and card): a tag that would is moved
 * down past what it hits. Tags that end up off screen are left out.
 */
export function placeParaTags(
  boxes: Array<{ id: string; r: Rect }>,
  size: { w: number; h: number },
  view: { vw: number; vh: number; top: number },
  avoid: Rect[],
): Map<string, Rect> {
  const out = new Map<string, Rect>();
  const placed: Rect[] = [];
  const gap = 10;
  const sorted = [...boxes].sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  for (const { id, r } of sorted) {
    let x = r.x - gap - size.w;
    let y = Math.max(r.y, view.top);
    if (x < 8) {
      x = Math.min(Math.max(8, r.x), Math.max(8, view.vw - size.w - 8));
      y = Math.max(r.y - size.h - 6, view.top);
    }
    let tag: Rect = { x, y, w: size.w, h: size.h };
    for (let n = 0; n < 40; n++) {
      const hit = [...placed, ...avoid].find((o) => overlaps(tag, { x: o.x - 2, y: o.y - 2, w: o.w + 4, h: o.h + 4 }));
      if (!hit) break;
      tag = { ...tag, y: hit.y + hit.h + 4 };
    }
    if (tag.y + tag.h <= 0 || tag.y >= view.vh) continue;
    placed.push(tag);
    out.set(id, tag);
  }
  return out;
}
