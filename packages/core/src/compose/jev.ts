// Round 10: who the layout is for, and Jev's check of every layout that passed the code checks, in ONE call.
// Design B: each group's page text and its layout (as plain text, see flatten) sit inside that group's questions;
// the shared state holds the reader brief and the page.
//   better_<id>   Noul: for THIS reader, is the new layout easier to read and use than the page's own text, without
//                 losing anything? Contrastive criteria; "the page's own text is already as clear" is the escape.
//   dropped_<id>  Noul, the round 9 question: does the layout leave out a fact, number, condition, limit or warning?
//   added_<id>    Noul, the round 9 question: does the layout state a new claim?
// Missing answers fail closed (better 0, dropped 1, added 1).
import { noulOf } from '../jev/api';
import type { JevQuestion, JevResponse } from '../jev/api';
import { readerBrief } from '../reword/brief';
import { ADDED_CRITERIA, DROPPED_CRITERIA, Q_ADDED, Q_DROPPED } from '../reword/jev';
import type { ComposeGroupIn, ReaderProfile, RewordPage } from '../types';

/** Bump when the catalog, the planner prompt or the checks change: cached answers are keyed by it. */
export const COMPOSE_CATALOG_VERSION = 'wa-compose-2';

/**
 * A group shows its components only when Jev's dropped and added are under these (round 9's REWRITE_CHECK values)
 * and its better is at or above betterMin.
 */
export const COMPOSE_CHECK = Object.freeze({ droppedMax: 0.65, addedMax: 0.5, betterMin: 0.5 });

/** The reader when the person has not brought their AI's answer. */
export const GENERAL_READER_BRIEF =
  'A general adult reader who does not know this field: everyday words; common terms are fine, rare or official terms get a few words of meaning. Wants the main point easy to find and steps, amounts, dates and warnings easy to spot. Fine with short paragraphs.';

/** The brief Jev and the planner read: the person's saved reader, or a general reader. */
export function composeBrief(reader: ReaderProfile | null): string {
  return reader ? readerBrief(reader) : GENERAL_READER_BRIEF;
}

/**
 * How far the layout should lean, from the reader's defaults (the brief's points say which fields are new to them):
 * a newcomer gets steps, key facts and definitions; an expert keeps more prose and tables.
 */
export function composeLeaning(reader: ReaderProfile | null): string {
  if (!reader) {
    return 'General reader: use components where the page gives steps, figures, a warning, contact details or a comparison; keep explanations, arguments and stories as prose; a definition only for an official term a general reader would not know.';
  }
  if (reader.level === 'expert') {
    return 'Expert reader: components only where they add precision or speed: key facts or stats for exact thresholds, dates, amounts and deadlines; a compare table where the page compares; a key callout with the direct answer when they want answers first; a warning or important callout for a stated restriction. Everything else stays prose in the page\'s exact words (text ""): never loosen a rule, round a number or split a rule from its exceptions; no definitions for terms of a field they know.';
  }
  const newcomer = reader.level === 'plain' || reader.shape !== 'prose';
  if (newcomer) {
    return 'Newcomer to this topic: favour numbered steps for any order the page gives, key facts for amounts, dates and limits, definitions for terms new to them (see READER), a callout for each warning or deadline the page states, and short plain sentences in prose. Components are welcome wherever they make the page easier to use.';
  }
  return 'Everyday reader: use components where they make facts, steps or warnings easier to find; keep explanations as prose in everyday words; define only terms new to them.';
}

export const betterId = (id: string): string => `better_${id}`;
export const composeDroppedId = (id: string): string => `dropped_${id}`;
export const composeAddedId = (id: string): string => `added_${id}`;

export const Q_COMPOSE_BETTER =
  "For THIS reader, is the new layout easier to read and use than the page's own text, without losing anything the page says?";
export const COMPOSE_BETTER_CRITERIA = Object.freeze({
  true:
    'Easier for this reader: the layout lets this reader find and use what the page says faster: steps the page gives in order are numbered, figures and dates stand out, terms new to this reader are explained, a warning or deadline is set apart, a comparison is a table; or the wording is plainer at this reader\'s level. Every fact, condition and link of the page is still there.',
  false:
    "Not easier, or not worth changing: the page's own text is already as clear for this reader; the layout chops an explanation, argument or story that reads better as paragraphs; a condition or exception is split from what it limits; boxes, titles or icons add clutter without helping; it explains terms this reader already knows or uses terms they do not; or something the page says is lost or changed.",
});

export const COMPOSE_CHECK_NOTE =
  "Each group of questions holds one part of a web page: the page's own text (page_text) and a layout of the same content for one reader (new_layout). In new_layout, [Key facts], [Steps], [Table], [Warning: …], [Main point: …], [Words explained], [Quote], [Contact] and [Points] label the parts; step numbers are the order, not facts; short titles and labels name what follows and are not claims. ⟦1⟧, ⟦2⟧ … are the same links in both.";

/** "⟦1⟧": "Where's My Refund?", for every marker with known words (null when none are known). */
export function composeLinkWords(group: ComposeGroupIn): Record<string, string> | null {
  const out: Record<string, string> = {};
  group.linkTexts.forEach((t, i) => {
    const w = t.replace(/\s+/g, ' ').trim().slice(0, 120);
    if (w) out[`⟦${i + 1}⟧`] = w;
  });
  return Object.keys(out).length ? out : null;
}

export interface ComposeCheckItem {
  id: string;
  heading: string | null;
  /** The page's own text of the group (groupText). */
  source: string;
  /** The layout as plain text (flatten). */
  layout: string;
  links: Record<string, string> | null;
}

/** One call for every group that passed the code checks: better, dropped and added per group. */
export function buildComposeCheckCall(brief: string, page: RewordPage, items: ComposeCheckItem[]): { state: unknown; questions: Record<string, JevQuestion> } {
  const questions: Record<string, JevQuestion> = {};
  for (const it of items) {
    const links = it.links ? { link_words: it.links } : {};
    const heading = it.heading ? { heading: it.heading } : {};
    questions[betterId(it.id)] = {
      type: 'noul',
      instructions: { question: Q_COMPOSE_BETTER, ...heading, page_text: it.source, new_layout: it.layout, ...links },
      criteria: { true: COMPOSE_BETTER_CRITERIA.true, false: COMPOSE_BETTER_CRITERIA.false },
    };
    questions[composeDroppedId(it.id)] = {
      type: 'noul',
      instructions: { question: Q_DROPPED, original: it.source, new_version: it.layout, ...links },
      criteria: { true: DROPPED_CRITERIA.true, false: DROPPED_CRITERIA.false },
    };
    questions[composeAddedId(it.id)] = {
      type: 'noul',
      instructions: { question: Q_ADDED, original: it.source, new_version: it.layout, ...links },
      criteria: { true: ADDED_CRITERIA.true, false: ADDED_CRITERIA.false },
    };
  }
  return {
    state: { reader: brief, page: { title: page.title, site: page.host, kind: page.purpose ?? 'unknown' }, note: COMPOSE_CHECK_NOTE },
    questions,
  };
}

export interface ComposeVerdict {
  better: number;
  dropped: number;
  added: number;
}

/** better, dropped and added per group id (missing answers: better 0, dropped 1, added 1). */
export function parseComposeCheck(ids: string[], resp: JevResponse): Record<string, ComposeVerdict> {
  return Object.fromEntries(
    ids.map((id) => [
      id,
      { better: noulOf(resp, betterId(id)) ?? 0, dropped: noulOf(resp, composeDroppedId(id)) ?? 1, added: noulOf(resp, composeAddedId(id)) ?? 1 },
    ]),
  );
}

/** The reason a judged layout is not shown, or null when it passes every bar. */
export function verdictFailure(v: ComposeVerdict): 'dropped' | 'added' | 'plain_is_better' | null {
  if (v.dropped >= COMPOSE_CHECK.droppedMax) return 'dropped';
  if (v.added >= COMPOSE_CHECK.addedMax) return 'added';
  if (v.better < COMPOSE_CHECK.betterMin) return 'plain_is_better';
  return null;
}
