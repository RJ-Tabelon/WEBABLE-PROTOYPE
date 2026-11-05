// Round 7 package J: the meaning check before Calm view. No network.
import { describe, expect, it } from 'vitest';
import type { MeaningCheckRequest } from '../../src/types';
import {
  LEADS_ID, MEANING_POLICY, MISSING_ID, buildMeaningCall, meaningRegionText, parseMeaning, sanitizeMeaningRequest,
} from '../../src/jev/meaning';
import { emptyJevMetrics } from '../../src/jev/api';
import { noul, response } from '../a1/fixtures';

/** Caden's screenshot 9: Calm view led with a news teaser and a photo and dropped the record and the logos. */
const SCREENSHOT_9: MeaningCheckRequest = {
  purpose: 'record_stats',
  original: {
    mainRegion: 'main region: scoreboard, stat_value, stat_label, team_or_org_logo',
    leadRoles: ['scoreboard', 'team_or_org_logo', 'stat_value', 'stat_label'],
    mustKeep: ['scoreboard', 'team_or_org_logo', 'stat_value', 'stat_label', 'data_table'],
  },
  calm: {
    leadRoles: ['page_title', 'lead_image', 'teaser_other_content'],
    shownRoles: ['page_title', 'lead_image', 'teaser_other_content', 'body_text'],
    foldedRoles: ['scoreboard', 'team_or_org_logo', 'stat_value', 'stat_label', 'data_table'],
  },
};

describe('sanitizeMeaningRequest', () => {
  it('keeps known fine roles once, in order, and a known purpose', () => {
    const r = sanitizeMeaningRequest({
      ...SCREENSHOT_9,
      purpose: 'banana' as never,
      calm: { leadRoles: ['page_title', 'page_title', 'Wins 54' as never, 'lead_image'], shownRoles: [], foldedRoles: [] },
    });
    expect(r.purpose).toBeNull();
    expect(r.calm.leadRoles).toEqual(['page_title', 'lead_image']);
  });

  it('reduces the region description to role names and interface words, without digits or names', () => {
    expect(meaningRegionText('main region: scoreboard, stat_value, team_or_org_logo')).toBe('main region scoreboard stat_value team_or_org_logo');
    expect(meaningRegionText('Wins 54 Losses 22 Rachel Siegel record')).toBe('record');
    expect(meaningRegionText(undefined)).toBe('');
  });
});

describe('buildMeaningCall', () => {
  it('asks two Nouls over structure only, with code-computed differences and a role glossary', () => {
    const call = buildMeaningCall(SCREENSHOT_9);
    expect(Object.keys(call.questions)).toEqual([LEADS_ID, MISSING_ID]);
    expect(call.questions[LEADS_ID]!.type).toBe('noul');
    const st = call.state as Record<string, Record<string, unknown>>;
    expect(st.page!.purpose).toBe('record_stats');
    expect(st.checked_by_code).toEqual({
      calm_lead_from_main_information: [],
      calm_lead_from_elsewhere: ['page_title', 'lead_image', 'teaser_other_content'],
      distractions_in_calm_lead: ['teaser_other_content'],
      must_keep_not_shown: ['scoreboard', 'team_or_org_logo', 'stat_value', 'stat_label', 'data_table'],
      must_keep_folded: ['scoreboard', 'team_or_org_logo', 'stat_value', 'stat_label', 'data_table'],
    });
    expect(Object.keys(st.roles!)).toContain('teaser_other_content');
    // never page text or numbers (only the role glossary carries the criteria's own examples)
    expect(JSON.stringify([st.page, st.original, st.calm, st.checked_by_code])).not.toMatch(/\d/);
  });

  it('refuses a request with nothing to compare', () => {
    expect(() => buildMeaningCall({ ...SCREENSHOT_9, original: { mainRegion: 'x', leadRoles: [], mustKeep: [] } })).toThrow();
  });
});

describe('parseMeaning', () => {
  it('passes only when it leads with the main information (>= 0.80) and nothing main is missing (<= 0.20)', () => {
    const v = (leads: number, missing: number) =>
      parseMeaning(response({ [LEADS_ID]: noul(leads), [MISSING_ID]: noul(missing) }), emptyJevMetrics()).pass;
    expect(MEANING_POLICY).toEqual({ leadsWithMain: 0.8, missingMain: 0.2 });
    expect(v(0.98, 0.02)).toBe(true);
    expect(v(0.8, 0.2)).toBe(true);
    expect(v(0.79, 0.02)).toBe(false);
    expect(v(0.98, 0.21)).toBe(false);
    expect(v(0.03, 0.99)).toBe(false);
  });

  it('fails closed on a missing answer', () => {
    expect(() => parseMeaning(response({ [LEADS_ID]: noul(0.9) }), emptyJevMetrics())).toThrow();
  });
});
