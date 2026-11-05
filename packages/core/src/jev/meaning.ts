// Meaning check (round 7): before Calm view shows anything, Jev compares the Calm plan with the original page. Owner: J.
//
// Two Nouls over a structure-only summary (fine roles, the page purpose and an allowlisted region description; never
// page text or numbers):
//   leads_with_main  does the Calm version lead with what the page exists to show?
//   missing_main     is any of the page's main information missing from the Calm version?
// pass = leads_with_main >= 0.80 and missing_main <= 0.20. Code adds the set differences it can compute exactly
// (which of the calm version's first roles come from the main information, which are distractions, which main roles
// are not shown or were folded) as evidence; Jev judges what they mean for this kind of page.
import type { FineRole, JevMetrics, MeaningCheckRequest, MeaningVerdict, PagePurpose } from '../types';
import { allowlistWords } from '../redact';
import { noulOf } from './api';
import type { JevQuestion, JevResponse } from './api';
import { DISTRACTION_ROLES, FINE_CRITERIA, FINE_ROLES, PAGE_PURPOSES, PURPOSE_CRITERIA } from './page';

export const MEANING_CATALOG_VERSION = 'wa-meaning-1';
export const MEANING_POLICY = Object.freeze({ leadsWithMain: 0.8, missingMain: 0.2 });
/** Most roles kept per list (a Calm plan names each fine role once). */
export const MEANING_MAX_ROLES = 24;

export const LEADS_ID = 'leads_with_main';
export const MISSING_ID = 'missing_main';

export const Q_LEADS =
  'Does the calm version described in `calm` lead with what the page described in `original` exists to show? `page.purpose` says what kind of page it is.';
export const Q_MISSING =
  'Is any of the main information of the page described in `original` missing from the calm version described in `calm`?';

export const LEADS_CRITERIA = Object.freeze({
  true: "Its first roles (`calm.lead_roles`) are mostly the page's main information (`original.lead_roles` and `original.must_keep`), in any order; a title, summary or text around them is fine.",
  false: 'Its first roles are mostly teasers for other pages, ads, promotions, menus, or a picture or text that is not the main information, or the main information is not among them.',
});
export const MISSING_CRITERIA = Object.freeze({
  true: 'A role in `original.must_keep` is not in `calm.shown_roles`, or was folded away, so a visitor would lose part of what the page exists to show.',
  false: 'Everything in `original.must_keep` is shown in the calm version; only roles outside the main information were folded.',
});

/** How many of the calm version's first roles the code compares with the original's main information. */
export const MEANING_LEAD_WINDOW = 4;

// page.ts re-exports this module, so its constants are read lazily (they are not initialised yet while this loads).
let fineSet: Set<string> | null = null;
let purposeSet: Set<string> | null = null;
const isFine = (x: string): boolean => (fineSet ??= new Set<string>(FINE_ROLES)).has(x);
const isPurpose = (x: string): boolean => (purposeSet ??= new Set<string>(PAGE_PURPOSES)).has(x);
let distractionSet: Set<string> | null = null;
const isDistractionRole = (x: string): boolean => (distractionSet ??= new Set<string>(DISTRACTION_ROLES)).has(x);

function roles(xs: unknown): FineRole[] {
  const out: FineRole[] = [];
  if (!Array.isArray(xs)) return out;
  for (const x of xs) {
    if (typeof x === 'string' && isFine(x) && !out.includes(x as FineRole)) out.push(x as FineRole);
    if (out.length >= MEANING_MAX_ROLES) break;
  }
  return out;
}

/** A short region description: fine-role names and interface words only, no digits, at most 12 words. */
export function meaningRegionText(s: unknown): string {
  const out: string[] = [];
  for (const raw of String(s ?? '').replace(/[0-9]+/g, ' ').split(/[\s,;:()]+/)) {
    const t = raw.trim();
    if (!t) continue;
    if (isFine(t)) out.push(t);
    else {
      const w = allowlistWords(t).replace(/·/g, ' ').replace(/[^\p{L}\- ]+/gu, ' ').trim();
      if (w) out.push(...w.split(/\s+/));
    }
    if (out.length >= 12) break;
  }
  return out.slice(0, 12).join(' ');
}

/**
 * Keep only known fine roles (deduplicated, in order, capped), a known purpose, and an allowlisted region description.
 * Used on both sides: the extension builds the request, the server cleans it again.
 */
export function sanitizeMeaningRequest(req: MeaningCheckRequest): MeaningCheckRequest {
  const purpose = typeof req?.purpose === 'string' && isPurpose(req.purpose) ? (req.purpose as PagePurpose) : null;
  return {
    purpose,
    original: {
      mainRegion: meaningRegionText(req?.original?.mainRegion),
      leadRoles: roles(req?.original?.leadRoles),
      mustKeep: roles(req?.original?.mustKeep),
    },
    calm: {
      leadRoles: roles(req?.calm?.leadRoles),
      shownRoles: roles(req?.calm?.shownRoles),
      foldedRoles: roles(req?.calm?.foldedRoles),
    },
  };
}

/** The roles a request mentions, with their one-line meanings (so bare role names are unambiguous). */
function glossary(req: MeaningCheckRequest): Record<string, string> {
  const out: Record<string, string> = {};
  const all = [
    ...req.original.leadRoles, ...req.original.mustKeep, ...req.calm.leadRoles, ...req.calm.shownRoles, ...req.calm.foldedRoles,
  ];
  for (const r of all) if (!(r in out)) out[r] = FINE_CRITERIA[r] ?? r.replace(/_/g, ' ');
  return out;
}

/** One Jev call: the state carries the two structure summaries, code's exact set differences and a role glossary. */
export function buildMeaningCall(input: MeaningCheckRequest): { state: Record<string, unknown>; questions: Record<string, JevQuestion> } {
  const req = sanitizeMeaningRequest(input);
  if (req.original.mustKeep.length === 0 && req.original.leadRoles.length === 0) throw new Error('nothing to compare');
  const shown = new Set(req.calm.shownRoles);
  const folded = new Set(req.calm.foldedRoles);
  const main = new Set([...req.original.leadRoles, ...req.original.mustKeep]);
  const lead = req.calm.leadRoles.slice(0, MEANING_LEAD_WINDOW);
  const state = {
    page: {
      purpose: req.purpose ?? 'unknown',
      ...(req.purpose ? { purpose_means: PURPOSE_CRITERIA[req.purpose] } : {}),
    },
    original: {
      main_region: req.original.mainRegion || 'unknown',
      lead_roles: req.original.leadRoles,
      must_keep: req.original.mustKeep,
    },
    calm: {
      lead_roles: req.calm.leadRoles,
      shown_roles: req.calm.shownRoles,
      folded_roles: req.calm.foldedRoles,
    },
    checked_by_code: {
      calm_lead_from_main_information: lead.filter((r) => main.has(r)),
      calm_lead_from_elsewhere: lead.filter((r) => !main.has(r)),
      distractions_in_calm_lead: lead.filter((r) => isDistractionRole(r)),
      must_keep_not_shown: req.original.mustKeep.filter((r) => !shown.has(r)),
      must_keep_folded: req.original.mustKeep.filter((r) => folded.has(r)),
    },
    roles: glossary(req),
  };
  const questions: Record<string, JevQuestion> = {
    [LEADS_ID]: { type: 'noul', instructions: Q_LEADS, criteria: { true: LEADS_CRITERIA.true, false: LEADS_CRITERIA.false } },
    [MISSING_ID]: { type: 'noul', instructions: Q_MISSING, criteria: { true: MISSING_CRITERIA.true, false: MISSING_CRITERIA.false } },
  };
  return { state, questions };
}

/** The verdict; throws when an answer is missing (callers fail closed: no Calm view offered). */
export function parseMeaning(resp: JevResponse, metrics: JevMetrics): MeaningVerdict {
  const leads = noulOf(resp, LEADS_ID);
  const missing = noulOf(resp, MISSING_ID);
  if (leads === null || missing === null) throw new Error('missing meaning answers');
  return {
    leadsWithMain: leads,
    missingMain: missing,
    pass: leads >= MEANING_POLICY.leadsWithMain && missing <= MEANING_POLICY.missingMain,
    metrics,
  };
}
