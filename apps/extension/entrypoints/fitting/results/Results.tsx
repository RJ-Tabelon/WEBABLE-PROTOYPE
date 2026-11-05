// The last screen (docs/design/ONBOARDING.md, round 8c point 5). It leads with what makes the web harder for this
// person, strongly and in their own numbers, then what WebAble does about each. Then the chart of what gets in their
// way, real websites to try it on, every setting in plain word levels, and a footer. Every change saves at once
// through onChange. Nothing a person sees here is a pixel value or a technical word. Round 9: after the struggle
// cards, one card to bring in how the person likes things explained, from their AI assistant (fitting.html#ai).
import type { FitProfile, Polarity, ReaderProfile } from '@webable/core';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Logo } from '../../../src/ui/Logo';
import { PointRow } from '../ai/AiScreen';
import { ExplainIcon } from '../ai/icons';
import { fromWords, PROBLEM_WORDS, type ImportProblem } from '../ai/reader';
import type { RunEvidence } from '../logic/evidence';
import {
  BUTTON_LEVELS,
  buttonLabel,
  buttonLevel,
  canStepText,
  currentText,
  faintLevel,
  stepText,
  textLabel,
  textLevel,
  withButtonLevel,
  withFaint,
  withMotion,
  withPolarity,
  withSteady,
  type ButtonLevel,
  type FaintLevel,
} from './adjust';
import { Segmented, Stepper, Switch } from './controls';
import { CheckIcon, OutIcon, StruggleIcon } from './icons';
import { FIX_OFF_LINE, STRUGGLE_LABELS, amountWords, anyStrong, fixOn, struggleCards, struggleValues } from './needs';
import { Radar } from './Radar';
import './results.css';

export interface ResultsProps {
  fit: FitProfile; // what was just saved (or loaded)
  measured: boolean; // false when opened as settings without a fresh run
  /** Their own numbers from the run (round 8c). Null or missing when opened later without them, or in the demo. */
  evidence?: RunEvidence | null;
  onChange(next: FitProfile): void; // App saves via logic/storage.ts and re-renders
  onRetake(): void;
  onDone(): void; // closes the tab
  /** Round 9: what WebAble took from the person's AI answer, when saved. */
  reader?: ReaderProfile | null;
  /** Round 9: opens fitting.html#ai. Without it the card is not shown. */
  onReader?(): void;
  /** Round 10: the onboarding's last step is still reading the AI answer, or could not. */
  readerJob?: { status: 'reading' | 'failed'; source: string | null; problem?: ImportProblem } | null;
  /** Round 10: a point switched on or off on Results (App saves it). */
  onReaderPoints?(next: ReaderProfile): void;
}

/** "See it on real websites": real pages WebAble changes by itself (round 8c point 5). */
const REAL_SITES: ReadonlyArray<{ name: string; host: string; url: string; caption: string }> = [
  { name: 'CNN', host: 'cnn.com', url: 'https://www.cnn.com', caption: 'News, as a clean page with the story first' },
  {
    name: 'Allrecipes',
    host: 'allrecipes.com',
    url: 'https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/',
    caption: 'Just the ingredients and the steps',
  },
  {
    name: 'Florida Gators',
    host: 'floridagators.com',
    url: 'https://floridagators.com/sports/football/opponent-history/university-of-kentucky/32',
    caption: 'The score and the record, up front',
  },
  { name: 'IRS', host: 'irs.gov', url: 'https://www.irs.gov/refunds', caption: 'The same page, easier to read' },
];

function useReducedMotion(): boolean {
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  const [reduced, setReduced] = useState(query?.matches ?? false);
  useEffect(() => {
    if (!query) return;
    const on = (): void => setReduced(query.matches);
    query.addEventListener('change', on);
    return () => query.removeEventListener('change', on);
  }, []);
  return reduced;
}

const listJoin = (xs: string[]): string =>
  xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

export function Results(props: ResultsProps): JSX.Element {
  const { measured, onRetake, onDone } = props;
  const evidence = props.evidence ?? null;
  const [fit, setFit] = useState<FitProfile>(props.fit);
  useEffect(() => setFit(props.fit), [props.fit]);
  // What gets in their way is about them, not about the settings: read it from the fit as the page opened, so changing
  // a setting below never rewrites their problems (only whether each fix is on).
  const [opened] = useState<FitProfile>(props.fit);
  const reduced = useReducedMotion();
  const title = useRef<HTMLHeadingElement>(null);
  const sitesRef = useRef<HTMLElement>(null);

  useEffect(() => {
    title.current?.focus({ preventScroll: true });
  }, []);

  const change = (next: FitProfile): void => {
    if (next === fit) return;
    setFit(next);
    props.onChange(next);
  };

  const values = useMemo(() => struggleValues(opened, evidence), [opened, evidence]);
  const cards = useMemo(() => struggleCards(opened, evidence, values), [opened, evidence, values]);
  const strong = anyStrong(values);
  const cardIds = new Set(cards.map((c) => c.id));
  const summary = cards.length
    ? `What gets in your way: most of all ${listJoin(cards.map((c) => STRUGGLE_LABELS[c.id].toLowerCase()))}.`
    : 'What gets in your way: hardly anything.';

  const onReal = !evidence || evidence.sites.length > 0;
  const h1 = strong ? 'Here’s what makes the web harder for you.' : 'The web mostly works for you.';
  const deck = !strong
    ? 'A few things still get in the way. WebAble takes care of them.'
    : !measured
      ? 'From what you did when you set up WebAble.'
      : onReal
        ? 'From what you just did, including on real websites.'
        : 'From what you just did.';

  const toSites = (): void => {
    sitesRef.current?.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <div class="rs">
      <header class="rs-top">
        <div class="rs-wrap">
          <span class="rs-mark"><Logo />WebAble</span>
        </div>
      </header>

      <main class="rs-wrap">
        <section class="rs-hero">
          <div class="rs-lead">
            <p class="rs-status">
              <span class="rs-status-dot" aria-hidden="true" />
              WebAble is on
            </p>
            <h1 class="rs-h1" ref={title} tabIndex={-1}>
              {h1}
            </h1>
            <p class="rs-deck">{deck}</p>

            <ol class="rs-cards" aria-label="What makes the web harder for you">
              {cards.map((c) => {
                const on = fixOn(c.id, fit);
                return (
                  <li class="rs-card" key={c.id}>
                    <span class="rs-card-icon">
                      <StruggleIcon id={c.id} />
                    </span>
                    <div class="rs-card-body">
                      <p class="rs-problem">{c.problem}</p>
                      <p class="rs-evidence">{c.evidence}</p>
                      {on ? (
                        <p class="rs-fix">
                          <span class="rs-fix-check">
                            <CheckIcon />
                          </span>
                          <span>
                            <strong>WebAble fixes this:</strong> {c.fix}
                          </span>
                        </p>
                      ) : (
                        <p class="rs-fix is-off">{FIX_OFF_LINE}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>

            {props.onReader ? (
              <ReaderCard
                reader={props.reader ?? null}
                job={props.readerJob ?? null}
                onOpen={props.onReader}
                onPoints={props.onReaderPoints}
              />
            ) : null}

            <div class="rs-actions">
              <button type="button" class="btn btn-primary rs-btn" onClick={toSites}>
                See it on real websites
              </button>
              <button type="button" class="btn btn-secondary rs-btn" onClick={onDone}>
                Done
              </button>
            </div>
          </div>

          <figure class="rs-chart card">
            <figcaption class="rs-chart-title">What gets in your way</figcaption>
            <Radar
              values={values.map((s) => s.value)}
              labels={values.map((s) => s.label)}
              emphasis={values.map((s) => cardIds.has(s.id))}
              words={values.map((s) => amountWords(s.value))}
              summary={summary}
              reduced={reduced}
            />
            <p class="rs-chart-note">The further out, the more it gets in your way.</p>
          </figure>
        </section>

        <section class="rs-section" aria-labelledby="rs-sites" ref={sitesRef}>
          <div class="rs-section-head">
            <div>
              <h2 class="rs-h2" id="rs-sites">
                See it on real websites
              </h2>
              <p class="rs-sub">WebAble is on. Open any of these and it works by itself.</p>
            </div>
          </div>
          <ul class="rs-sites">
            {REAL_SITES.map((s) => (
              <li key={s.url}>
                <a class="rs-site" href={s.url} target="_blank" rel="noopener noreferrer">
                  <span class="rs-site-top">
                    <span class="rs-site-name">{s.name}</span>
                    <span class="rs-site-out">
                      <OutIcon />
                    </span>
                  </span>
                  <span class="rs-site-caption">{s.caption}</span>
                  <span class="rs-site-host">
                    {s.host}
                    <span class="visually-hidden"> (opens in a new tab)</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>

        <Adjust fit={fit} onChange={change} />

        <footer class="rs-foot">
          <p>WebAble keeps learning as you browse. Change anything here, any time, from the WebAble button on any page.</p>
          <button type="button" class="btn-text rs-restart" onClick={onRetake}>
            Start over
          </button>
        </footer>
      </main>
    </div>
  );
}

/* ---------------- How you like things explained (round 9) ---------------- */

/**
 * What WebAble took from the person's AI answer (round 10: the onboarding's last step ends here). While the answer is
 * still being read it says so; if it could not be read, it says that plainly with a way to try again. With a saved
 * one: its headline and each point with the answer's own words, each switchable (saved at once).
 */
function ReaderCard(props: {
  reader: ReaderProfile | null;
  job: ResultsProps['readerJob'];
  onOpen(): void;
  onPoints?(next: ReaderProfile): void;
}): JSX.Element {
  const { reader, job, onOpen, onPoints } = props;
  const from = (source: string | null): string => source?.trim() || 'your AI';
  let title: string;
  let line: string;
  let action: string | null;
  if (job?.status === 'reading') {
    title = `Reading what ${from(job.source)} said…`;
    line = 'This takes a few seconds. It shows here when it’s done.';
    action = null;
  } else if (job?.status === 'failed' && !reader) {
    title = 'Your AI’s answer couldn’t be read';
    line = PROBLEM_WORDS[job.problem ?? 'unavailable'];
    action = 'Try again';
  } else if (reader) {
    title = reader.headline;
    line = `${fromWords(reader.source)}. Switch off anything that’s wrong.`;
    action = 'Change';
  } else {
    title = 'Pages can explain things the way you like';
    line = 'Bring what your AI assistant already knows about how you like things explained.';
    action = 'Bring it in';
  }
  const showPoints = !!reader && job?.status !== 'reading' && !!onPoints;
  return (
    <section class="rs-ai" aria-label="How you like things explained" aria-busy={job?.status === 'reading' ? true : undefined}>
      <span class="rs-card-icon">
        <ExplainIcon />
      </span>
      <div class="rs-card-body">
        <p class="rs-problem">{title}</p>
        <p class="rs-evidence">{line}</p>
        {showPoints ? (
          <ul class="ai-points rs-ai-points" aria-label="What WebAble took from your AI">
            {reader.points.map((p) => (
              <PointRow
                key={p.id}
                point={p}
                source={reader.source}
                onToggle={(id, on) => onPoints({ ...reader, points: reader.points.map((x) => (x.id === id ? { ...x, on } : x)) })}
              />
            ))}
          </ul>
        ) : null}
        {action ? (
          <button type="button" class="btn btn-secondary rs-btn rs-ai-btn" onClick={onOpen} data-answer="reader">
            {action}
          </button>
        ) : null}
      </div>
    </section>
  );
}

/* ---------------- Adjust anything ---------------- */

function Row(props: {
  label: string;
  hint: string;
  change?: JSX.Element | string | null;
  wide?: boolean;
  children: JSX.Element;
}): JSX.Element {
  return (
    <div class={`rs-row${props.wide ? ' is-wide' : ''}`}>
      <div class="rs-row-text">
        <div class="rs-row-label">{props.label}</div>
        <div class="rs-row-hint">{props.hint}</div>
      </div>
      <div class="rs-row-change" aria-live="polite">
        {props.change}
      </div>
      <div class="rs-row-control">{props.children}</div>
    </div>
  );
}

/** "Standard → Large", or "No change" when nothing moves. Words only. */
function wordChange(from: string, to: string | null): JSX.Element | string {
  if (!to) return 'No change';
  return (
    <>
      {from} → <strong>{to}</strong>
    </>
  );
}

const FAINT_WORDS: Record<FaintLevel, string | null> = { off: null, darker: 'Darker', darkest: 'Darkest' };
const POLARITY_WORDS: Record<Polarity, string | null> = { none: null, light: 'Light', dark: 'Dark' };

function Adjust({ fit, onChange }: { fit: FitProfile; onChange(next: FitProfile): void }): JSX.Element {
  const level = textLevel(fit);
  const buttons = buttonLevel(fit);
  const polarity: Polarity = fit.polarity?.value ?? 'none';
  return (
    <section class="rs-section" aria-labelledby="rs-adjust">
      <div class="rs-section-head">
        <div>
          <h2 class="rs-h2" id="rs-adjust">
            Adjust anything
          </h2>
          <p class="rs-sub">Changes save as you make them.</p>
        </div>
      </div>
      <div class="rs-rows card">
        <Row
          label="Text size"
          hint="How big words are on every page."
          change={wordChange('Standard', level > 0 ? textLabel(fit) : null)}
          wide
        >
          <div class="rs-text-control">
            <span class="rs-aa" aria-hidden="true">
              <span style={{ fontSize: `${currentText(fit)}px` }}>Aa</span>
            </span>
            <Stepper
              canDown={canStepText(fit, -1)}
              canUp={canStepText(fit, 1)}
              downLabel="Smaller text"
              upLabel="Larger text"
              onStep={(d) => onChange(stepText(fit, d))}
            />
          </div>
        </Row>
        <Row
          label="Button size"
          hint="How big buttons and links are to click."
          change={wordChange('Standard', buttons === 'standard' ? null : buttonLabel(fit))}
          wide
        >
          <Segmented<ButtonLevel>
            label="Button size"
            wide
            options={BUTTON_LEVELS.map((l) => ({ value: l.value, label: l.label }))}
            value={buttons}
            onChange={(v) => onChange(withButtonLevel(fit, v))}
          />
        </Row>
        <Row label="Faint text" hint="Light grey words, made darker." change={wordChange('Grey', FAINT_WORDS[faintLevel(fit)])} wide>
          <Segmented<FaintLevel>
            label="Faint text"
            wide
            options={[
              { value: 'off', label: 'Leave as is' },
              { value: 'darker', label: 'Darker' },
              { value: 'darkest', label: 'Darkest' },
            ]}
            value={faintLevel(fit)}
            onChange={(v) => onChange(withFaint(fit, v))}
          />
        </Row>
        <Row
          label="Light or dark"
          hint="Bright pages turned dark, or the other way."
          change={wordChange('As the site', POLARITY_WORDS[polarity])}
          wide
        >
          <Segmented<Polarity>
            label="Light or dark"
            wide
            options={[
              { value: 'light', label: 'Light' },
              { value: 'dark', label: 'Dark' },
              { value: 'none', label: 'As the site' },
            ]}
            value={polarity}
            onChange={(v) => onChange(withPolarity(fit, v))}
          />
        </Row>
        <Row
          label="Keep my clicks steady"
          hint="Your click stays on what you meant, even if your hand moves."
          change={fit.clicks.steady.on ? <strong>On</strong> : 'Off'}
        >
          <Switch label="Keep my clicks steady" checked={fit.clicks.steady.on} onChange={(on) => onChange(withSteady(fit, on))} />
        </Row>
        <Row
          label="Pause moving things"
          hint="Slideshows and moving ads stand still."
          change={fit.attention.motion.on ? <strong>On</strong> : 'Off'}
        >
          <Switch label="Pause moving things" checked={fit.attention.motion.on} onChange={(on) => onChange(withMotion(fit, on))} />
        </Row>
      </div>
    </section>
  );
}
