// Round 9: try writer prompt variants on a few paragraphs for one reader (prompt tuning). Run from apps/server:
//   npx tsx --env-file=../../.env ../../scripts/reword/try-writer.ts [variant]
import { readerBrief, changeShare, outText, REWORD_MODEL } from '../../packages/core/src/index';
import type { ReaderProfile, RewordKind, RewordOut } from '../../packages/core/src/index';
import { respondJson } from '../../apps/server/src/openai';
import { REWORD_INSTRUCTIONS, REWORD_SCHEMA, rewordInput } from '../../apps/server/src/prompts';

const maya: ReaderProfile = {
  v: 'reader.1', createdAt: '', source: 'ChatGPT', headline: '', level: 'plain', length: 'shorter', shape: 'steps', answerFirst: false,
  points: [
    { id: 'r1', kind: 'knows', says: 'You know graphic design and photography terms well.', evidence: '', support: 1, on: true },
    { id: 'r2', kind: 'new_to', says: 'US tax, paperwork and bank terms are new to you; you like them explained simply.', evidence: '', support: 1, on: true },
    { id: 'r3', kind: 'language', says: 'English is your second language; short sentences without idioms work best.', evidence: '', support: 1, on: true },
    { id: 'r4', kind: 'format', says: 'You like short numbered steps, one idea per sentence.', evidence: '', support: 1, on: true },
  ],
};
const page = { title: 'Refunds | Internal Revenue Service', host: 'www.irs.gov', purpose: null };
const CASES: Array<[RewordKind, string]> = [
  ['plain', 'Your refund may also be reduced to pay a past due debt such as child support, federal agency nontax debt or state income tax. The Bureau of the Fiscal Service (BFS), which issues IRS refunds, will mail a notice about the debt offset. The details of the offset aren’t provided to the IRS.'],
  ['plain', 'Sometimes we make changes or corrections to your tax return which could increase your refund amount. When this happens, we’ll mail you a notice explaining the adjustment.'],
  ['plain', 'BFS will review your claim and the signature on the canceled check to determine if the IRS can issue you a new refund check. This review can take up to 6 weeks to complete.'],
  ['point_first', 'If you believe your refund was increased accidentally or you received a refund you aren’t entitled to, then you must promptly ⟦1⟧.'],
  ['plain', 'It’s true that Gen Z abhors fake cheeriness, said Loren Margolis, coauthor of “⟦1⟧: Perspectives and Practices Across the Field.” This generation sees many social interactions that older generations consider requisite for building a positive and polite work climate as fake, she said.'],
];
const variant = process.argv[2] ?? 'current';
const effort = process.argv[3] as 'none' | 'low' | undefined;
const brief = readerBrief(maya);
const t0 = performance.now();
await Promise.all(CASES.map(async ([kind, text], i) => {
  const r = await respondJson({
    model: REWORD_MODEL, instructions: REWORD_INSTRUCTIONS, input: rewordInput(brief, maya.level, page, kind, text),
    schemaName: 'reword', schema: REWORD_SCHEMA, maxOutputTokens: 2000, timeoutMs: 12_000, cacheKey: `try-${variant}`, tag: 'try',
    ...(effort ? { effort } : {}),
  } as Parameters<typeof respondJson>[0]);
  if (!r.ok) return console.log(i, kind, 'FAIL', r.error);
  const out = r.data as RewordOut;
  console.log(`\n#${i} ${kind} ${r.ms} ms change ${changeShare(text, out)}\n  ${outText(out).replace(/\n/g, '\n  ')}`);
}));
console.log(`\nall ${Math.round(performance.now() - t0)} ms`);
