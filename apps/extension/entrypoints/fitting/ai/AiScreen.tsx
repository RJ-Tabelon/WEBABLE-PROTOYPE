// Round 9, fitting.html#ai: bring in how the person likes things explained, from the AI assistant they use most.
// One thing at a time: Ask (send the question, paste the answer), Reading (5–20 s, calm, no fake progress), what
// WebAble took from it (each point with the answer's own words, each one can be switched off), then Done with two
// real pages to see it on. With a saved one it opens on its points, and switches save at once.
// Never shown here: "reword", "profile", "score", "probability" or a pixel.

import { AI_ASK_URLS, AI_PROMPT, type ReaderPoint, type ReaderProfile } from '@webable/core';
import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Switch } from '../results/controls';
import { OutIcon } from '../results/icons';
import { CheckIcon, TopBar } from '../ui/Chrome';
import { fromWords, ImportError, importReader, longEnough, PROBLEM_WORDS, saveReader, type AiSource, type ImportProblem } from './reader';
import './ai.css';

type Step =
  | { kind: 'ask'; problem: ImportProblem | null }
  | { kind: 'reading' }
  /** Just read, not saved yet: switches only change what Save keeps. */
  | { kind: 'review'; reader: ReaderProfile }
  /** Already saved: switches save at once. */
  | { kind: 'saved' }
  | { kind: 'done' };

/** Real pages to see it on. */
export const AI_PAGES: ReadonlyArray<{ label: string; host: string; url: string }> = [
  { label: 'Where’s my refund, on the IRS site', host: 'irs.gov', url: 'https://www.irs.gov/refunds' },
  { label: 'A health story on CNN', host: 'cnn.com', url: 'https://www.cnn.com/2026/10/24/health/gen-z-stare-wellness' },
];

const COPIED_MS = 2400;
const NO_PARTS: ReadonlySet<never> = new Set();

export interface AiScreenProps {
  /** What is saved now, or null. */
  saved: ReaderProfile | null;
  /** Called after every save or removal, with what is saved now. */
  onSaved(reader: ReaderProfile | null): void;
  onClose(): void;
}

export function AiScreen(props: AiScreenProps): JSX.Element {
  const { saved, onSaved, onClose } = props;
  const [step, setStep] = useState<Step>(saved ? { kind: 'saved' } : { kind: 'ask', problem: null });
  const [text, setText] = useState('');
  const [source, setSource] = useState<AiSource | null>(null);
  const [announce, setAnnounce] = useState('');
  const alive = useRef(true);
  /** What was saved before this import; the background saves an import at once, so backing out puts this back. */
  const before = useRef<ReaderProfile | null>(saved);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(
    () => () => {
      alive.current = false;
    },
    [],
  );
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo?.({ top: 0 });
  }, [step.kind]);
  // Removed from elsewhere (the test hook): back to the start.
  useEffect(() => {
    if (step.kind === 'saved' && !saved) setStep({ kind: 'ask', problem: null });
  }, [saved, step.kind]);

  const read = async (): Promise<void> => {
    before.current = saved;
    setStep({ kind: 'reading' });
    setAnnounce('Reading what your AI said.');
    try {
      const reader = await importReader(text, source);
      if (!alive.current) return;
      setStep({ kind: 'review', reader });
      setAnnounce('');
    } catch (err) {
      if (!alive.current) return;
      setStep({ kind: 'ask', problem: err instanceof ImportError ? err.problem : 'unavailable' });
      setAnnounce('');
    }
  };

  const save = async (reader: ReaderProfile): Promise<void> => {
    const kept = await saveReader(reader);
    before.current = kept;
    onSaved(kept);
    if (alive.current) setStep({ kind: 'done' });
  };

  /** From a fresh read: put back what was saved before, then start again with an empty box. */
  const pasteAgain = async (): Promise<void> => {
    if (step.kind === 'review') await saveReader(before.current);
    setText('');
    setStep({ kind: 'ask', problem: null });
  };

  const toggleSaved = (id: string, on: boolean): void => {
    if (!saved) return;
    const next: ReaderProfile = { ...saved, points: saved.points.map((p) => (p.id === id ? { ...p, on } : p)) };
    onSaved(next);
    void saveReader(next);
  };

  const remove = async (): Promise<void> => {
    await saveReader(null);
    before.current = null;
    onSaved(null);
    setText('');
    setSource(null);
    setStep({ kind: 'ask', problem: null });
    setAnnounce('Removed. Pages keep their own words.');
  };

  let body: JSX.Element;
  if (step.kind === 'ask') {
    body = (
      <Ask
        heading={heading}
        text={text}
        problem={step.problem}
        onText={setText}
        onSource={setSource}
        onContinue={() => void read()}
        back={saved ? { label: 'Back', go: () => setStep({ kind: 'saved' }) } : { label: 'Not now', go: onClose }}
      />
    );
  } else if (step.kind === 'reading') {
    body = (
      <section class="ai-card ai-reading card" aria-busy="true">
        <span class="ai-wait" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <h1 class="ai-h1" ref={heading} tabIndex={-1}>
          Reading what your AI said…
        </h1>
        <p class="ai-deck">This can take up to 20 seconds.</p>
      </section>
    );
  } else if (step.kind === 'review') {
    const reader = step.reader;
    body = (
      <Points
        heading={heading}
        eyebrow="What WebAble took from it"
        reader={reader}
        deck="Switch off anything that’s wrong, then save."
        onToggle={(id, on) =>
          setStep({ kind: 'review', reader: { ...reader, points: reader.points.map((p) => (p.id === id ? { ...p, on } : p)) } })
        }
      >
        <div class="ai-actions">
          <button type="button" class="btn btn-primary ai-btn" onClick={() => void save(reader)} data-answer="save">
            Save
          </button>
          <button type="button" class="btn btn-secondary ai-btn" onClick={() => void pasteAgain()} data-answer="paste-again">
            Paste a different answer
          </button>
        </div>
      </Points>
    );
  } else if (step.kind === 'saved' && saved) {
    body = (
      <Points
        heading={heading}
        eyebrow="How you like things explained"
        reader={saved}
        deck={`${fromWords(saved.source)}. Switch off anything that’s wrong. Changes save as you make them.`}
        onToggle={toggleSaved}
      >
        <SavedActions onClose={onClose} onPasteNew={() => void pasteAgain()} onRemove={() => void remove()} />
      </Points>
    );
  } else {
    body = <Done heading={heading} onClose={onClose} />;
  }

  return (
    <div class="fl-app ai">
      <TopBar parts={null} current={null} done={NO_PARTS} ticking={false} onSkip={null} />
      <main class="fl-main">
        <div class="fl-col">{body}</div>
      </main>
      <div class="visually-hidden" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}

/* ---------------- 1. Ask ---------------- */

function Ask(props: {
  heading: preact.RefObject<HTMLHeadingElement>;
  text: string;
  problem: ImportProblem | null;
  onText(text: string): void;
  onSource(source: AiSource | null): void;
  onContinue(): void;
  /** A quiet way out: back to what is saved, or "Not now". */
  back: { label: string; go(): void };
}): JSX.Element {
  return (
    <section class="ai-card card" aria-labelledby="ai-title">
      <h1 class="ai-h1" id="ai-title" ref={props.heading} tabIndex={-1}>
        Let pages explain things the way you like
      </h1>
      <p class="ai-deck">
        Your AI assistant already knows how you like things explained. Ask it once, paste its answer here, and WebAble
        will word and lay out the pages you read the way you like.
      </p>
      <AskSteps {...props} />
    </section>
  );
}

/**
 * The two steps (ask the AI, paste its answer) and Continue. Shared by #ai and the onboarding's last step, which
 * gives them its own title.
 */
export function AskSteps(props: {
  text: string;
  problem: ImportProblem | null;
  onText(text: string): void;
  onSource(source: AiSource | null): void;
  onContinue(): void;
  /** A quiet way out next to Continue, or none. */
  back: { label: string; go(): void } | null;
}): JSX.Element {
  const { text, problem } = props;
  const [copied, setCopied] = useState(false);
  const question = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async (): Promise<void> => {
    props.onSource(null);
    let ok = false;
    try {
      await navigator.clipboard.writeText(AI_PROMPT);
      ok = true;
    } catch {
      // No clipboard: select the question so the person can copy it themselves.
      const el = question.current;
      const sel = window.getSelection();
      if (el && sel) {
        const range = document.createRange();
        range.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(range);
      }
    }
    if (!ok) return;
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), COPIED_MS);
  };

  const ready = longEnough(text);
  return (
    <ol class="ai-steps">
      <li class="ai-step">
        <h2 class="ai-step-title">
          <span class="ai-num" aria-hidden="true">
            1
          </span>
          Ask the AI you use most
        </h2>
        <div class="ai-ask">
          {(['ChatGPT', 'Claude'] as const).map((name) => (
            <a
              key={name}
              class="btn btn-primary ai-btn"
              href={AI_ASK_URLS[name]}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => props.onSource(name)}
              data-answer={`ask-${name.toLowerCase()}`}
            >
              Ask {name}
              <span class="visually-hidden"> (opens in a new tab)</span>
            </a>
          ))}
          <button type="button" class="btn btn-secondary ai-btn" onClick={() => void copy()} data-answer="copy-question">
            {copied ? (
              <>
                <CheckIcon size={18} /> Copied
              </>
            ) : (
              'Copy the question'
            )}
          </button>
        </div>
        <p class="ai-hint">ChatGPT and Claude open with the question filled in. For any other AI, copy it and paste it there.</p>
        <div class="ai-question" ref={question} tabIndex={0} role="region" aria-label="The question">
          {AI_PROMPT}
        </div>
      </li>

      <li class="ai-step">
        <h2 class="ai-step-title" id="ai-paste">
          <span class="ai-num" aria-hidden="true">
            2
          </span>
          Paste its answer
        </h2>
        <textarea
          class="ai-answer"
          aria-labelledby="ai-paste"
          aria-describedby={problem ? 'ai-problem' : undefined}
          aria-invalid={problem ? true : undefined}
          rows={8}
          spellcheck={false}
          value={text}
          onInput={(e) => props.onText((e.currentTarget as HTMLTextAreaElement).value)}
          data-answer="answer"
        />
        {problem ? (
          <p class="ai-problem" id="ai-problem" role="alert">
            {PROBLEM_WORDS[problem]}
          </p>
        ) : null}
        <div class="ai-actions">
          <button type="button" class="btn btn-primary ai-btn" disabled={!ready} onClick={props.onContinue} data-answer="continue">
            Continue
          </button>
          {props.back ? (
            <button type="button" class="btn-text ai-quiet" onClick={props.back.go} data-answer="back">
              {props.back.label}
            </button>
          ) : null}
        </div>
      </li>
    </ol>
  );
}

/* ---------------- 3. What WebAble took from it ---------------- */

function Points(props: {
  heading: preact.RefObject<HTMLHeadingElement>;
  eyebrow: string;
  reader: ReaderProfile;
  deck: string;
  onToggle(id: string, on: boolean): void;
  children: JSX.Element;
}): JSX.Element {
  const { reader } = props;
  return (
    <section class="ai-card card" aria-labelledby="ai-title">
      <p class="ai-eyebrow">{props.eyebrow}</p>
      <h1 class="ai-h1" id="ai-title" ref={props.heading} tabIndex={-1}>
        {reader.headline}
      </h1>
      <p class="ai-deck">{props.deck}</p>
      <ul class="ai-points" aria-label="What WebAble took from your AI">
        {reader.points.map((p) => (
          <PointRow key={p.id} point={p} source={reader.source} onToggle={props.onToggle} />
        ))}
      </ul>
      {props.children}
    </section>
  );
}

export function PointRow(props: { point: ReaderPoint; source: string; onToggle(id: string, on: boolean): void }): JSX.Element {
  const { point } = props;
  return (
    <li class={`ai-point${point.on ? '' : ' is-off'}`} data-point={point.id}>
      <div class="ai-point-text">
        <p class="ai-says">{point.says}</p>
        {point.evidence ? (
          <p class="ai-quote">
            {fromWords(props.source)}: ‘{point.evidence}’
          </p>
        ) : null}
      </div>
      <Switch checked={point.on} label={point.says} onChange={(on) => props.onToggle(point.id, on)} />
    </li>
  );
}

function SavedActions(props: { onClose(): void; onPasteNew(): void; onRemove(): void }): JSX.Element {
  const [confirming, setConfirming] = useState(false);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirming) keep.current?.focus();
  }, [confirming]);
  return (
    <>
      <div class="ai-actions">
        <button type="button" class="btn btn-primary ai-btn" onClick={props.onClose} data-answer="close">
          Done
        </button>
        <button type="button" class="btn btn-secondary ai-btn" onClick={props.onPasteNew} data-answer="paste-new">
          Paste a new answer
        </button>
      </div>
      <div class="ai-remove">
        {confirming ? (
          <p class="ai-confirm" role="group" aria-label="Remove">
            <span>Remove this? Pages go back to their own words.</span>
            <button type="button" class="btn-text ai-confirm-yes" onClick={props.onRemove} data-answer="remove-yes">
              Remove
            </button>
            <button type="button" class="btn-text" ref={keep} onClick={() => setConfirming(false)} data-answer="remove-no">
              Keep it
            </button>
          </p>
        ) : (
          <button type="button" class="btn-text" onClick={() => setConfirming(true)} data-answer="remove">
            Remove
          </button>
        )}
      </div>
    </>
  );
}

/* ---------------- 4. Done ---------------- */

function Done(props: { heading: preact.RefObject<HTMLHeadingElement>; onClose(): void }): JSX.Element {
  return (
    <section class="ai-card ai-done card" aria-labelledby="ai-title">
      <span class="ai-done-mark" aria-hidden="true">
        <CheckIcon size={36} />
      </span>
      <h1 class="ai-h1" id="ai-title" ref={props.heading} tabIndex={-1}>
        Done. Pages will now explain things the way you like.
      </h1>
      <h2 class="ai-sub" id="ai-see">
        See it on a real page
      </h2>
      <ul class="ai-pages" aria-labelledby="ai-see">
        {AI_PAGES.map((p) => (
          <li key={p.url}>
            <a class="ai-page" href={p.url} target="_blank" rel="noopener noreferrer">
              <span class="ai-page-text">
                <span class="ai-page-label">{p.label}</span>
                <span class="ai-page-host">
                  {p.host}
                  <span class="visually-hidden"> (opens in a new tab)</span>
                </span>
              </span>
              <span class="ai-page-out">
                <OutIcon />
              </span>
            </a>
          </li>
        ))}
      </ul>
      <div class="ai-actions">
        <button type="button" class="btn btn-secondary ai-btn" onClick={props.onClose} data-answer="close">
          Close
        </button>
      </div>
    </section>
  );
}
