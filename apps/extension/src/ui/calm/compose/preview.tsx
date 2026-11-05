// Round 10: a sample WebAble page with every component kind, for checking by eye. Content is drawn from the IRS refunds
// page, the CFPB's credit score pages and a news story (a dev preview only; never shipped).
// Open preview.html (Vite transforms this file). From the repo root: pnpm exec vite --host 127.0.0.1 --port 5197
// Query: ?text=2 (the person's text at 200%), ?w=420 (a narrow column), ?build=1 (each group settles in, as on a page).
import type { ComposeBlock } from '@webable/core';
import { render, type JSX } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { EngineApi } from '../../../contracts';
import { calmCss } from '../../base.css';
import { tokensFor, tokensToStyle } from '../../tokens';
import { Calm, type CalmCtx } from '../context';
import type { LinkPart } from '../model';
import { pageCss } from '../page.css';
import { Composed } from './Composed';
import { composeCss } from './compose.css';

function link(text: string, href: string): LinkPart {
  const el = document.createElement('a');
  el.href = href;
  el.textContent = text;
  return { t: 'link', el, text, href, help: false };
}

interface Group { id: string; heading: string; plain: string[]; links: LinkPart[]; blocks: ComposeBlock[] }

const GROUPS: Group[] = [
  {
    id: 'g-refund-status',
    heading: 'Check your refund status',
    links: [link("Where's My Refund", 'https://www.irs.gov/wheres-my-refund'), link('IRS2Go app', 'https://www.irs.gov/newsroom/irs2goapp')],
    plain: [
      "Use Where's My Refund to check your federal tax refund status. You can also check it in the IRS2Go app. You'll need your Social Security number or ITIN, your filing status and your exact refund amount.",
      'You can start checking on the status of your return within 24 hours after you e-filed a tax year 2025 return, 3 or 4 days after you e-filed a tax year 2023 or 2024 return, and 4 weeks after you mailed your return.',
    ],
    blocks: [
      { k: 'prose', src: ['u1'], text: 'Use ⟦1⟧ to check where your federal tax refund is. You can also check it in the ⟦2⟧.' },
      {
        k: 'keyfacts', src: ['u1'], title: 'What you need', icon: 'clipboard-list',
        rows: [
          { label: 'Your number', value: 'Social Security number or ITIN', icon: 'circle-check' },
          { label: 'Your filing status', value: 'Single, married or head of household', icon: 'circle-check' },
          { label: 'Your refund', value: 'The exact amount on your return', icon: 'circle-check' },
        ],
      },
      {
        k: 'stats', src: ['u2'],
        tiles: [
          { label: 'Filed online, 2025 return', value: '24 hours', note: 'after you e-file', icon: 'clock' },
          { label: 'Filed online, 2023 or 2024', value: '3–4 days', note: 'after you e-file', icon: 'calendar' },
          { label: 'Mailed a paper return', value: '4 weeks', note: 'after you mail it', icon: 'mail' },
        ],
      },
    ],
  },
  {
    id: 'g-refund-timing',
    heading: 'When you will get your refund',
    links: [],
    plain: [
      'We issue most refunds in less than 21 calendar days. However, if you filed on paper or are expecting a refund for an amended return, it could take longer.',
      "Where's My Refund shows your refund in three stages: Return Received, Refund Approved and Refund Sent. Once it is approved, we send it to your bank or mail it to you.",
      "By law, we can't issue refunds for returns claiming the Earned Income Tax Credit or Additional Child Tax Credit before mid-February. Don't call us unless it has been 21 days or more since you filed online, or 6 weeks or more since you mailed your return.",
    ],
    blocks: [
      { k: 'callout', src: ['u1'], tone: 'key', title: 'Most refunds take less than 21 days', text: 'Paper returns and amended returns can take longer.', icon: null },
      {
        k: 'steps', src: ['u2'], title: 'How your refund moves', lead: "Where's My Refund shows three stages:",
        steps: [
          { title: 'Return Received', detail: 'The IRS has your return and is working on it.' },
          { title: 'Refund Approved', detail: 'Your refund amount is confirmed.' },
          { title: 'Refund Sent', detail: 'Your refund is on its way to your bank, or in the mail.' },
        ],
      },
      {
        k: 'keyfacts', src: ['u3'], title: 'Call only if', icon: 'phone',
        rows: [
          { label: 'You filed online', value: '21 days or more ago', icon: null },
          { label: 'You mailed your return', value: '6 weeks or more ago', icon: null },
          { label: "Where's My Refund", value: 'Tells you to contact the IRS', icon: null },
          { label: 'Refund hotline', value: '800-829-1954', icon: null },
        ],
      },
      {
        k: 'callout', src: ['u3'], tone: 'warning', title: 'Some refunds wait until mid-February',
        text: "By law, refunds for returns claiming the Earned Income Tax Credit or the Additional Child Tax Credit can't be issued before mid-February.",
        icon: null,
      },
    ],
  },
  {
    id: 'g-credit-factors',
    heading: 'What goes into a credit score',
    links: [link('AnnualCreditReport.com', 'https://www.annualcreditreport.com/')],
    plain: [
      'Credit scores typically range from 300 to 850. Scores are calculated from the information in your credit report: your payment history, how much you owe, how long you have had credit, new credit and the types of credit you use.',
      'You can get free weekly credit reports from each of the three nationwide credit reporting companies at AnnualCreditReport.com.',
    ],
    blocks: [
      {
        k: 'points', src: ['u1'], title: null,
        items: [
          { icon: 'calendar', title: 'Payment history', text: 'Whether you pay your bills on time, and how late any late payments were.' },
          { icon: 'wallet', title: 'How much you owe', text: 'How much of your available credit you are using.' },
          { icon: 'hourglass', title: 'Length of credit history', text: 'How long your accounts have been open.' },
          { icon: 'credit-card', title: 'New credit and credit mix', text: 'Recent applications, and the kinds of credit you have.' },
        ],
      },
      { k: 'callout', src: ['u2'], tone: 'tip', title: 'Check your reports for free', text: 'Get free weekly credit reports from each of the three nationwide companies at ⟦1⟧.', icon: null },
      {
        k: 'definitions', src: ['u1'], title: null,
        items: [
          { term: 'Credit report', meaning: 'A record of your credit history: your accounts, payments and any debts in collection.' },
          { term: 'Credit score', meaning: 'A number from your credit report that predicts how likely you are to pay a loan back on time.' },
        ],
      },
    ],
  },
  {
    id: 'g-credit-models',
    heading: 'FICO and VantageScore',
    links: [],
    plain: ['Two companies make most credit scores. FICO scores range from 300 to 850 and need at least 6 months of history. VantageScore also ranges from 300 to 850 and needs 1 month of history.'],
    blocks: [
      {
        k: 'compare', src: ['u1'], title: null,
        columns: ['', 'FICO Score', 'VantageScore'],
        rows: [
          { label: 'Score range', cells: ['300 to 850', '300 to 850'] },
          { label: 'History needed', cells: ['At least 6 months', 'At least 1 month'] },
          { label: 'Used by', cells: ['Most mortgage lenders', 'Many card issuers and apps'] },
        ],
      },
    ],
  },
  {
    id: 'g-storm',
    heading: 'Residents wait out the storm',
    links: [link('evacuation zone', 'https://example.org/zones')],
    plain: [
      '"We boarded up the windows on Tuesday and filled the bathtub. Now we just wait," said Maria Lopez, who has lived in Tampa for 30 years.',
      'Officials urged anyone in an evacuation zone to leave before winds reach 40 mph. Call 813-272-5900 or email info@example.org for shelter information.',
    ],
    blocks: [
      { k: 'quote', src: ['u1'], text: 'We boarded up the windows on Tuesday and filled the bathtub. Now we just wait.', who: 'Maria Lopez', role: 'Tampa resident for 30 years' },
      { k: 'prose', src: ['u2'], text: 'Officials urged anyone in an ⟦1⟧ to leave before winds reach 40 mph.' },
      {
        k: 'contact', src: ['u2'], title: 'Shelter information',
        rows: [
          { kind: 'phone', label: 'Phone', value: '813-272-5900' },
          { kind: 'email', label: 'Email', value: 'info@example.org' },
          { kind: 'hours', label: 'Open', value: 'Every day, 7 a.m. to 9 p.m.' },
        ],
      },
    ],
  },
];

const params = new URLSearchParams(location.search);
const scale = Number(params.get('text')) || 1;
const narrow = Number(params.get('w')) || 0;
const build = params.get('build') === '1';

const api = {} as EngineApi;
const ctx = {
  api, splitN: Infinity, groupSize: 8, reduceMotion: false,
  click: () => undefined, pressPrimary: () => undefined, peek: () => undefined, step: 0, goStep: () => undefined,
  showDrawer: () => undefined, drawerCall: 0, errorEl: null, kind: 'article', textCol: 720,
} as CalmCtx;

function Plain({ g }: { g: Group }): JSX.Element {
  return (
    <div class="wa-cx-prose">
      {g.plain.map((p, i) => (
        <p key={i} class="wa-p">{p}</p>
      ))}
    </div>
  );
}

function Page(): JSX.Element {
  // ?build=1: the page's own words first; then each group settles into its components, top to bottom, within 3 s.
  const [ready, setReady] = useState(build ? 0 : GROUPS.length);
  useEffect(() => {
    if (!build) return;
    const timers = GROUPS.map((_, i) => window.setTimeout(() => setReady(i + 1), 600 + i * 500));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);
  return (
    <div class="wa-page">
      <div class="wa-col" style={narrow ? { width: `${narrow}px` } : undefined}>
        <header class="wa-lead">
          <h1 class="wa-h-page">Refunds, credit scores and the storm</h1>
          <p class="wa-orient">A sample page with every kind of component, for checking by eye.</p>
        </header>
        {GROUPS.map((g, i) => (
          <section key={g.id} class="wa-band">
            <h2 class="wa-h-section wa-head">{g.heading}</h2>
            {i < ready ? <Composed id={g.id} blocks={g.blocks} links={g.links} settle={build} /> : <Plain g={g} />}
          </section>
        ))}
      </div>
    </div>
  );
}

const host = document.getElementById('wa-compose-preview');
if (host) {
  const style = document.createElement('style');
  const preview = `
    html,body{margin:0;background:#FFFFFF}
    .wa-calm{position:relative;inset:auto;overflow:visible;min-height:100vh;padding:48px 0 96px}
  `;
  style.textContent = `${calmCss}\n${pageCss}\n${composeCss}\n${preview}`;
  document.head.append(style);
  const tokens = tokensToStyle(tokensFor(null, 'light', { surface: 'calm', scale }));
  render(
    <Calm.Provider value={ctx}>
      <div class="wa-calm" data-scheme="light" data-mode="light" style={tokens}>
        <Page />
      </div>
    </Calm.Provider>,
    host,
  );
}
