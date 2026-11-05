// Round 9: the reader brief. One compact plain description of how this person likes things explained, built from
// their saved ReaderProfile (points that are on, plus the level, length, shape and answer-first defaults). Jev reads
// it in the state of the paragraph questions; the writer reads it above every paragraph. Never shown to the person.
import type { ReaderPoint, ReaderProfile } from '../types';

/** The brief is cut to this many characters (whole points are dropped, never cut mid-sentence). */
export const READER_BRIEF_MAX_CHARS = 700;

const LEVEL_LINE: Record<ReaderProfile['level'], string> = {
  plain: 'Level: plain everyday words; any special term gets a few words of meaning.',
  everyday: 'Level: everyday words; common terms are fine, rare ones get a short meaning.',
  expert: "Level: expert; the field's own terms are fine and precision matters more than simplicity.",
};
const LENGTH_LINE: Record<ReaderProfile['length'], string> = {
  shorter: 'Length: wants shorter text.',
  as_is: 'Length: fine with full detail.',
};
const SHAPE_LINE: Record<ReaderProfile['shape'], string> = {
  steps: 'Shape: likes numbered steps.',
  bullets: 'Shape: likes bullet points.',
  prose: 'Shape: fine with paragraphs.',
};

/** Points in the order they matter most to a rewrite; points that do not fit are dropped from the end. */
const KIND_ORDER: ReadonlyArray<ReaderPoint['kind']> = ['knows', 'new_to', 'language', 'length', 'format', 'words', 'avoid'];

/**
 * `forWriter` leaves out how long they like text: the change Jev picked already says whether to make it shorter,
 * and the writer otherwise cut facts to suit a reader who "wants shorter text" (measured on IRS refunds).
 */
export function readerBrief(profile: ReaderProfile, opts: { forWriter?: boolean } = {}): string {
  const head = [
    LEVEL_LINE[profile.level] ?? LEVEL_LINE.everyday,
    opts.forWriter ? null : (LENGTH_LINE[profile.length] ?? LENGTH_LINE.as_is),
    SHAPE_LINE[profile.shape] ?? SHAPE_LINE.prose,
    profile.answerFirst ? 'Wants the main point or answer first.' : 'Fine with background before the main point.',
  ]
    .filter(Boolean)
    .join(' ');
  const points = profile.points
    .filter((p) => p.on && p.says.trim() && !(opts.forWriter && p.kind === 'length'))
    .map((p, i) => ({ p, i }))
    .sort((a, b) => KIND_ORDER.indexOf(a.p.kind) - KIND_ORDER.indexOf(b.p.kind) || a.i - b.i)
    .map(({ p }) => `- ${oneLine(p.says)}`);
  let out = head;
  if (points.length) {
    const lead = '\nWhat their AI assistant says about them ("you" is the reader):';
    let body = '';
    for (const line of points) {
      if ((out + lead + body + '\n' + line).length > READER_BRIEF_MAX_CHARS) continue;
      body += '\n' + line;
    }
    if (body) out += lead + body;
  }
  return out.slice(0, READER_BRIEF_MAX_CHARS);
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}
