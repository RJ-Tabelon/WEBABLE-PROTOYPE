// Round 9: negative controls for the rewrite check. Faithful rewrites next to deliberately broken ones (a fact,
// a condition or a number left out, advice or a fact added), through the same code checks and Jev call the write
// route uses. Calls Jev directly (no OpenAI). Run from apps/server so the key loads:
//   cd apps/server && npx tsx --env-file=../../.env ../../scripts/reword/controls.ts
import {
  REWRITE_CHECK, buildRewriteCheckCall, conditionsKept, linksKept, parseRewriteCheck, quotesKept, rewordNumbersKept,
} from '../../packages/core/src/index';
import type { RewordKind, RewordOut } from '../../packages/core/src/index';
import { askJev } from '../../apps/server/src/jev';

const OFFSET =
  'Your refund may also be reduced to pay a past due debt such as child support, federal agency nontax debt or state income tax. The Bureau of the Fiscal Service (BFS), which issues IRS refunds, will mail a notice about the debt offset. The details of the offset aren’t provided to the IRS.';
const RETURN_IT =
  'If you believe your refund was increased accidentally or you received a refund you aren’t entitled to, then you must promptly ⟦1⟧.';
const TRACE =
  'BFS will review your claim and the signature on the canceled check to determine if the IRS can issue you a new refund check. This review can take up to 6 weeks to complete.';
const STARE =
  'It’s true that Gen Z abhors fake cheeriness, said Loren Margolis, coauthor of “⟦1⟧: Perspectives and Practices Across the Field.” This generation sees many social interactions that older generations consider requisite for building a positive and polite work climate as fake, she said.';

const p = (lead: string, items: string[] = [], ordered = false): RewordOut => ({ lead, items, ordered });

const CASES: Array<{ id: string; want: 'pass' | 'fail'; what: string; kind: RewordKind; original: string; out: RewordOut }> = [
  {
    id: 'c1', want: 'pass', what: 'faithful plain', kind: 'plain', original: OFFSET,
    out: p('Your refund may be lowered to pay a debt you owe that is past due. This can be child support, a debt to a federal agency that is not a tax, or state income tax. The Bureau of the Fiscal Service (BFS) sends IRS refunds. BFS will mail you a notice about the debt offset (the money taken from your refund). The IRS does not get the details of the offset.'),
  },
  {
    id: 'c2', want: 'fail', what: 'fact left out (IRS gets no details)', kind: 'plain', original: OFFSET,
    out: p('Your refund may be lowered to pay a debt you owe that is past due. This can be child support, a debt to a federal agency that is not a tax, or state income tax. The Bureau of the Fiscal Service (BFS) sends IRS refunds. BFS will mail you a notice about the debt offset.'),
  },
  {
    id: 'c3', want: 'fail', what: 'one debt type left out (state income tax)', kind: 'plain', original: OFFSET,
    out: p('Your refund may be lowered to pay a debt you owe that is past due, such as child support or a debt to a federal agency that is not a tax. The Bureau of the Fiscal Service (BFS) sends IRS refunds and will mail you a notice about the debt offset. The IRS does not get the details of the offset.'),
  },
  {
    id: 'c4', want: 'fail', what: 'advice added', kind: 'plain', original: OFFSET,
    out: p('Your refund may be lowered to pay a past due debt, such as child support, a federal agency debt that is not a tax, or state income tax. BFS, which sends IRS refunds, will mail you a notice about the debt offset. The IRS does not get the details. Call BFS right away to dispute the offset.'),
  },
  {
    id: 'c5', want: 'pass', what: 'faithful point first', kind: 'point_first', original: RETURN_IT,
    out: p('You must promptly ⟦1⟧ if you believe your refund was increased by mistake, or if you got a refund you are not entitled to.'),
  },
  {
    id: 'c6', want: 'fail', what: 'one of two conditions left out', kind: 'point_first', original: RETURN_IT,
    out: p('You must promptly ⟦1⟧ if you believe your refund was increased by mistake.'),
  },
  {
    id: 'c7', want: 'fail', what: '"promptly" left out, "must" weakened to "can"', kind: 'point_first', original: RETURN_IT,
    out: p('You can ⟦1⟧ if you believe your refund was increased by mistake, or if you got a refund you are not entitled to.'),
  },
  {
    id: 'c8', want: 'pass', what: 'faithful list', kind: 'list', original: TRACE,
    out: p('What happens next:', ['BFS reviews your claim and the signature on the canceled check.', 'BFS decides if the IRS can send you a new refund check.', 'This review can take up to 6 weeks.'], true),
  },
  {
    id: 'c9', want: 'fail', what: 'number changed (6 -> 8 weeks)', kind: 'list', original: TRACE,
    out: p('What happens next:', ['BFS reviews your claim and the signature on the canceled check.', 'BFS decides if the IRS can send you a new refund check.', 'This review can take up to 8 weeks.'], true),
  },
  {
    id: 'c10', want: 'fail', what: '"up to" left out', kind: 'list', original: TRACE,
    out: p('What happens next:', ['BFS reviews your claim and the signature on the canceled check.', 'BFS decides if the IRS can send you a new refund check.', 'This review takes 6 weeks.'], true),
  },
  {
    id: 'c11', want: 'fail', what: 'second sentence cut', kind: 'plain', original: STARE,
    out: p('It’s true that Gen Z dislikes fake cheerfulness, said Loren Margolis, coauthor of “⟦1⟧: Perspectives and Practices Across the Field.”'),
  },
  {
    id: 'c12', want: 'pass', what: 'faithful plain, reported speech', kind: 'plain', original: STARE,
    out: p('Gen Z really dislikes fake cheerfulness, said Loren Margolis. She is a coauthor of “⟦1⟧: Perspectives and Practices Across the Field.” She said older generations think many social habits are needed for a positive, polite workplace. This generation sees many of those habits as fake.'),
  },
  {
    id: 'c13', want: 'fail', what: 'quote changed', kind: 'plain', original: '“For Gen Z and Gen Alpha, the peer relationship is the highest-valued social currency,” Butterick said.',
    out: p('“For Gen Z and Gen Alpha, peer relationships matter most,” Butterick said.'),
  },
];

const t0 = performance.now();
const code = CASES.map((c) => {
  const numbers = rewordNumbersKept(c.original, c.out);
  const conditions = conditionsKept(c.original, c.out, c.kind);
  const links = linksKept(c.original, c.out);
  const quotes = quotesKept(c.original, c.out);
  return { c, numbers, conditions, links, quotes, codeOk: numbers && conditions && links && quotes };
});
const call = buildRewriteCheckCall(CASES.map((c) => ({ id: c.id, original: c.original, rewrite: [c.out.lead, ...c.out.items].join('\n') })));
const r = await askJev({ state: call.state, questions: call.questions }, { tag: 'controls', fresh: true });
const v = parseRewriteCheck(CASES.map((c) => c.id), r.body);
let wrong = 0;
for (const { c, numbers, conditions, links, quotes, codeOk } of code) {
  const { dropped, added } = v[c.id]!;
  const jevOk = dropped < REWRITE_CHECK.droppedMax && added < REWRITE_CHECK.addedMax;
  const got = codeOk && jevOk ? 'pass' : 'fail';
  if (got !== c.want) wrong++;
  const codeNote = codeOk ? 'code ok' : `code FAIL (${[!numbers && 'numbers', !conditions && 'conditions', !links && 'links', !quotes && 'quotes'].filter(Boolean).join(',')})`;
  console.log(
    `${c.id.padEnd(4)} want ${c.want} got ${got}${got === c.want ? '  ' : ' X'}  dropped ${dropped.toFixed(2)} added ${added.toFixed(2)}  ${codeNote.padEnd(28)} ${c.what}`,
  );
}
console.log(`\n${CASES.length - wrong}/${CASES.length} as expected; Jev ${Math.round(r.wallMs)} ms for ${r.questions} questions; total ${Math.round(performance.now() - t0)} ms`);
console.log(`thresholds: dropped < ${REWRITE_CHECK.droppedMax}, added < ${REWRITE_CHECK.addedMax}`);
