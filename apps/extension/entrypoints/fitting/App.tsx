// The onboarding (docs/design/ONBOARDING.md, with round 8c winning): Welcome, then Reading · Pointing · Finding, one
// step at a time, each opened by an instruction card. Finding happens on real websites. Every press anywhere (the
// sites too) counts toward steady clicks. Nothing tells the person a result while the flow runs; at the end, core's
// deriveFit turns the raw answers into the person's settings, buildEvidence turns them into what they struggled with,
// and both are saved and shown once, on Results.
//
// Routes: fitting.html opens Welcome; fitting.html#settings opens Results with the saved settings and evidence (Welcome
// if there are no settings); fitting.html#ai opens the screens that bring in how the person likes things explained
// (round 9), also reached from Results. Leaving #ai goes back to Results when it came from there.

import {
  DEMO_FITS, defaultFit, deriveFit, type BrowserSettings, type FitProfile, type InputClass, type ReaderProfile, type WarmupMetrics,
} from '@webable/core';
import type { JSX } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AiScreen } from './ai/AiScreen';
import { importReader, ImportError, loadReader, readerHook, saveReader, type AiSource, type ImportProblem } from './ai/reader';
import { SENTENCES } from './content/sentences';
import { captureEnv, readBrowserSettings, readPageZoom, settingsUsed, type Env } from './logic/env';
import { makeRng } from './logic/rand';
import { RawCollector } from './logic/raw';
import { demoEvidence } from './logic/demo';
import { buildEvidence, type RunEvidence } from './logic/evidence';
import { eyebrowFor, PART_OF, partSetLine, PARTS, partsFor, planSteps, wordsFor, type PartId, type StepId } from './logic/steps';
import { closeThisTab, loadEvidence, loadFit, saveEvidence, saveFit } from './logic/storage';
import { Results } from './results/Results';
import { Welcome } from './screens/Welcome';
import { DotsTask } from './tasks/Dots';
import { FaintTask } from './tasks/Faint';
import { LightDarkTask } from './tasks/LightDark';
import { SitesTask } from './tasks/Sites';
import { SizeTask } from './tasks/Size';
import { ContextTask } from './tasks/Context';
import { TaskLayout, type StepOutcome, type TaskProps } from './tasks/Task';
import { TrueFalseTask } from './tasks/TrueFalse';
import { CheckIcon, TopBar } from './ui/Chrome';
import { Instruction } from './ui/Modal';

type View =
  | { kind: 'boot' }
  | { kind: 'welcome' }
  | { kind: 'intro'; step: StepId }
  | { kind: 'task'; step: StepId }
  | { kind: 'closing' }
  | ResultsView
  /** Round 9: bring in how the person likes things explained; `back` is the Results it was opened from. */
  | { kind: 'ai'; back: ResultsView | null };
type ResultsView = { kind: 'results'; fit: FitProfile; measured: boolean; evidence: RunEvidence | null };

/** Round 10: reading the AI answer from the last step, shown on Results ('reading' while the answer is read). */
export type ReaderJob = { status: 'reading' | 'failed'; source: string | null; problem?: ImportProblem };

/** The steps drawn from TaskProps; "Your context" is drawn on its own (it starts the AI answer's read). */
const TASKS: Record<Exclude<StepId, 'context'>, (p: TaskProps) => JSX.Element> = {
  size: SizeTask,
  truefalse: TrueFalseTask,
  faint: FaintTask,
  lightdark: LightDarkTask,
  dots: DotsTask,
  find: SitesTask,
};

/** The stage size each step uses, so the card behind the instruction already has the right shape. */
const STAGE_CLASS: Record<StepId, string> = {
  size: 'is-size',
  truefalse: 'is-read',
  faint: 'is-faint',
  lightdark: 'is-read',
  dots: 'is-dots',
  find: 'is-sites',
  context: 'is-context',
};

const CLOSING_MS = 1600;
/** "You're all set" waits this long at most for the AI answer to be read, so Results usually opens with it. */
const READER_WAIT_MS = 12_000;
const sleep = (ms: number): Promise<void> => new Promise((r) => window.setTimeout(r, ms));
const newSeed = (): number => (Math.random() * 2 ** 31) | 0;

function safeEvidence(raw: RawCollector): RunEvidence {
  try {
    return buildEvidence(raw.toRaw(), raw.sites);
  } catch {
    return { reading: null, faint: null, pointing: null, sites: [], busySlowdown: null, gotInWay: [] };
  }
}

function safeDerive(raw: RawCollector, settings: BrowserSettings | null, metrics?: WarmupMetrics): FitProfile {
  try {
    return deriveFit(raw.toRaw(), { settings, metrics: metrics ?? null });
  } catch {
    return defaultFit();
  }
}

export function App(): JSX.Element {
  const raw = useMemo(() => new RawCollector(), []);
  const [seed, setSeed] = useState(newSeed);
  const rng = useMemo(() => makeRng(seed), [seed]);
  const [env, setEnv] = useState<Env | null>(null);
  const [settings, setSettings] = useState<BrowserSettings | null>(null);
  const [view, setView] = useState<View>({ kind: 'boot' });
  const [steps, setSteps] = useState<StepId[]>([]);
  const [prev, setPrev] = useState<StepId | null>(null);
  const [doneParts, setDoneParts] = useState<Set<PartId>>(new Set());
  const [draft, setDraft] = useState<FitProfile>(defaultFit);
  const [ticking, setTicking] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [reader, setReader] = useState<ReaderProfile | null>(null);
  /** Bumped when the test hook saves or clears, so an open #ai screen starts again from what is saved. */
  const [aiKey, setAiKey] = useState(0);
  const touchedParts = useRef(new Set<PartId>());
  const anyDone = useRef(false);
  const input = useRef<{ moved: boolean; pointerType: string | null }>({ moved: false, pointerType: null });
  const tickTimer = useRef(0);
  const closingTimer = useRef(0);
  /** Bumped by every finish (and retake), so a "You're all set" still waiting on the AI answer does nothing late. */
  const closingGen = useRef(0);
  const [readerJob, setReaderJob] = useState<ReaderJob | null>(null);
  const readerRun = useRef<Promise<unknown> | null>(null);

  /* ---------------- boot: the browser's own settings before any press ---------------- */

  useEffect(() => {
    void (async () => {
      const zoom = await readPageZoom();
      raw.zoom = zoom;
      setEnv(captureEnv(SENTENCES.map((s) => s.text).join(' '), zoom));
      const s = await readBrowserSettings().catch(() => null);
      setSettings(s);
      setReader(await loadReader());
      if (location.hash === '#ai') {
        setView({ kind: 'ai', back: null });
        return;
      }
      if (location.hash === '#settings') {
        const saved = await loadFit();
        if (saved) {
          setView({ kind: 'results', fit: saved, measured: false, evidence: await loadEvidence() });
          return;
        }
      }
      setView({ kind: 'welcome' });
    })();
    return () => {
      window.clearTimeout(tickTimer.current);
      window.clearTimeout(closingTimer.current);
    };
  }, []);

  /* ---------------- #ai: in-app navigation and the browser's Back ---------------- */

  useEffect(() => {
    const onHash = (): void => {
      if (location.hash === '#ai') {
        setView((v) => (v.kind === 'boot' || v.kind === 'ai' ? v : { kind: 'ai', back: v.kind === 'results' ? v : null }));
        return;
      }
      setView((v) => (v.kind === 'ai' && v.back ? v.back : v));
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const openAi = (): void => {
    setView((v) => ({ kind: 'ai', back: v.kind === 'results' ? v : null }));
    try {
      history.pushState(null, '', '#ai');
    } catch {
      /* fine */
    }
  };

  const closeAi = (): void => {
    if (view.kind !== 'ai' || !view.back) {
      void closeThisTab();
      return;
    }
    setView(view.back);
    try {
      if (location.hash === '#ai') history.back();
    } catch {
      /* fine */
    }
  };

  /** Round 10, the last step: read the AI answer in the background (the background saves it as it arrives). */
  const startReaderImport = (text: string, source: AiSource | null): void => {
    setReaderJob({ status: 'reading', source });
    readerRun.current = importReader(text, source).then(
      (r) => {
        setReader(r);
        setReaderJob(null);
      },
      (err: unknown) => setReaderJob({ status: 'failed', source, problem: err instanceof ImportError ? err.problem : 'unavailable' }),
    );
  };

  // Test hook (round 9): `await __reader.load(text, 'ChatGPT')` reads an AI answer and saves it, `get()`, `clear()`.
  useEffect(() => {
    (globalThis as { __reader?: unknown }).__reader = readerHook((r) => {
      setReader(r);
      setAiKey((k) => k + 1);
    });
  }, []);

  /* ---------------- input type: inferred from the first presses, never asked ---------------- */

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') input.current.moved = true;
    };
    const down = (e: PointerEvent) => {
      input.current.moved = true;
      input.current.pointerType ??= e.pointerType;
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerdown', down, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', down, true);
    };
  }, []);

  /* ---------------- every press in the flow (Start buttons too), actions, hidden-tab time ---------------- */

  const inFlow = view.kind === 'welcome' || view.kind === 'intro' || view.kind === 'task';
  useEffect(() => {
    if (!inFlow) return;
    const down = (e: PointerEvent) => {
      raw.countAction();
      raw.onPointerDown(e);
    };
    const up = (e: PointerEvent) => raw.onPointerUp(e);
    const key = (e: KeyboardEvent) => {
      if (!e.repeat && !['Shift', 'Meta', 'Control', 'Alt'].includes(e.key)) raw.countAction();
    };
    const vis = () => {
      if (document.hidden) raw.stopClock();
      else if (view.kind !== 'welcome') raw.startClock();
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('keydown', key, true);
    document.addEventListener('visibilitychange', vis);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('keydown', key, true);
      document.removeEventListener('visibilitychange', vis);
    };
  }, [inFlow, view.kind]);

  /* ---------------- flow ---------------- */

  const openIntro = (step: StepId, plan: StepId[]) => {
    setView({ kind: 'intro', step });
    setAnnounce(`${eyebrowFor(step, plan)}. ${wordsFor(step, raw.inputClass).title}`);
  };

  const start = (e: MouseEvent) => {
    // Enter or Space on Start with no pointer movement: a keyboard user (click events from keys have detail 0).
    const keyboard = e.detail === 0 && !input.current.moved;
    const pt = input.current.pointerType;
    const cls: InputClass = keyboard
      ? 'keyboard'
      : pt === 'touch' || (pt == null && settings?.pointer === 'coarse')
        ? 'touch'
        : pt === 'pen'
          ? 'other'
          : 'mouse';
    raw.inputClass = cls;
    const plan = planSteps(cls, settings);
    if (cls === 'keyboard') raw.markBlock('point', 'not_run');
    if (settings?.forcedColors) {
      raw.markBlock('faint', 'prefilled');
      raw.skippedSteps.add('light or dark');
    }
    setSteps(plan);
    raw.startClock();
    const first = plan[0];
    if (first) openIntro(first, plan);
  };

  const beginStep = (step: StepId) => {
    if (step === 'size' || step === 'truefalse') raw.beginBlock('read');
    else if (step === 'faint') raw.beginBlock('faint');
    else if (step === 'dots') raw.beginBlock('point');
    else if (step === 'find') raw.beginBlock('find');
    setView({ kind: 'task', step });
  };

  /** Bookkeeping for a step the person skipped (or never reached when they skip the rest). */
  const markSkipped = (step: StepId) => {
    if (step === 'size') raw.skippedSteps.add('size');
    else if (step === 'truefalse') raw.endBlock('read', { trials: raw.ladder.length, skipped: true });
    else if (step === 'faint') raw.endBlock('faint', { trials: raw.faint.length, skipped: true });
    else if (step === 'lightdark') raw.skippedSteps.add('light or dark');
    else if (step === 'dots') raw.endBlock('point', { trials: 0, skipped: true });
    else if (step === 'find') {
      // The sites may be done already, with only the questions skipped.
      if (!raw.done.has('find')) raw.endBlock('find', { trials: raw.findTrials.length, skipped: true });
      raw.endBlock('pick', { trials: 0, skipped: true });
    }
  };

  const finish = async (measured: boolean, completed: boolean) => {
    window.clearTimeout(closingTimer.current);
    closingGen.current++;
    raw.stopClock();
    const metrics = raw.metrics({
      completed,
      corrections: { textSteps: 0, colours: false, rows: [] },
      settingsUsed: settings ? settingsUsed(settings) : [],
    });
    const fit = safeDerive(raw, settings, metrics);
    const evidence = safeEvidence(raw);
    await saveFit(fit);
    await saveEvidence(evidence);
    setView({ kind: 'results', fit, measured, evidence });
  };

  const advance = (step: StepId) => {
    const i = steps.indexOf(step);
    const next = steps[i + 1];
    const part = PART_OF[step];
    if (!next || PART_OF[next] !== part) setDoneParts((s) => new Set(s).add(part));
    setPrev(step);
    if (next) {
      openIntro(next, steps);
      return;
    }
    setView({ kind: 'closing' });
    setAnnounce('You’re all set.');
    // Round 10: while "You're all set" shows, the AI answer from the last step is read (up to READER_WAIT_MS), so
    // Results opens with what WebAble took from it; a slower read finishes on Results.
    const gen = ++closingGen.current;
    const reading = readerRun.current ? Promise.race([readerRun.current, sleep(READER_WAIT_MS)]) : Promise.resolve();
    void Promise.all([reading, sleep(CLOSING_MS)]).then(() => {
      if (gen === closingGen.current) void finish(anyDone.current, true);
    });
  };

  const stepDone = (step: StepId, o: StepOutcome) => {
    if (step === 'truefalse') raw.endBlock('read', o);
    else if (step === 'faint') raw.endBlock('faint', o);
    else if (step === 'dots') raw.endBlock('point', o);
    else if (step === 'find') raw.endBlock('pick', { trials: o.trials, stop: 'person' });
    anyDone.current = true;
    touchedParts.current.add(PART_OF[step]);
    // The settings so far shape the next steps (sizes); they are never shown until the end.
    setDraft(safeDerive(raw, settings));
    advance(step);
  };

  const skipStep = (step: StepId) => {
    markSkipped(step);
    advance(step);
  };

  /** "Skip for now": keep what was learned so far and show what WebAble will do. */
  const skipAll = async () => {
    if (view.kind === 'welcome') {
      const saved = await loadFit();
      if (saved) {
        setView({ kind: 'results', fit: saved, measured: false, evidence: await loadEvidence() });
        return;
      }
      for (const s of planSteps(raw.inputClass, settings)) markSkipped(s);
      await finish(false, false);
      return;
    }
    const at = view.kind === 'intro' || view.kind === 'task' ? steps.indexOf(view.step) : steps.length;
    for (const s of steps.slice(Math.max(0, at))) markSkipped(s);
    await finish(anyDone.current, false);
  };

  const onAnswer = () => {
    setTicking(true);
    window.clearTimeout(tickTimer.current);
    tickTimer.current = window.setTimeout(() => setTicking(false), 700);
  };

  const retake = () => {
    window.clearTimeout(closingTimer.current);
    closingGen.current++;
    readerRun.current = null;
    setReaderJob(null);
    raw.reset();
    setSeed(newSeed());
    setSteps([]);
    setPrev(null);
    setDoneParts(new Set());
    setDraft(defaultFit());
    touchedParts.current = new Set();
    anyDone.current = false;
    input.current = { moved: false, pointerType: null };
    try {
      history.replaceState(null, '', location.pathname);
    } catch {
      /* fine */
    }
    setView({ kind: 'welcome' });
  };

  // Test hook for automation (scripts/eval): `__fitting.phase()` names the screen ('welcome', 'intro:size',
  // 'task:find', 'results', ...); `__fitting.raw()` is the raw answers so far; `__fitting.evidence()` is what the run
  // shows so far; `await __fitting.finish('rosa' | 'typical' | 'reader')` saves that demo fit from core's DEMO_FITS and
  // a matching demo evidence, and jumps straight to Results, as if the steps had run.
  useEffect(() => {
    (globalThis as { __fitting?: unknown }).__fitting = {
      phase: () => (view.kind === 'intro' || view.kind === 'task' ? `${view.kind}:${view.step}` : view.kind),
      raw: () => raw.toRaw(),
      evidence: () => (view.kind === 'results' ? view.evidence : safeEvidence(raw)),
      finish: async (name: keyof typeof DEMO_FITS = 'rosa') => {
        window.clearTimeout(closingTimer.current);
        closingGen.current++;
        const key: keyof typeof DEMO_FITS = name in DEMO_FITS ? name : 'rosa';
        const fit: FitProfile = { ...(JSON.parse(JSON.stringify(DEMO_FITS[key])) as FitProfile), createdAt: new Date().toISOString() };
        const evidence = demoEvidence(key);
        await saveFit(fit);
        await saveEvidence(evidence);
        setView({ kind: 'results', fit, measured: true, evidence });
      },
    };
  });

  /* ---------------- render ---------------- */

  if (view.kind === 'boot' || !env) return <div class="fl-app" />;

  if (view.kind === 'ai') return <AiScreen key={aiKey} saved={reader} onSaved={setReader} onClose={closeAi} />;

  if (view.kind === 'results') {
    return (
      <div class="fl-results" key="results">
        <Results
          fit={view.fit}
          measured={view.measured}
          evidence={view.evidence}
          onChange={(next: FitProfile) => {
            void saveFit(next);
            setView((v) => (v.kind === 'results' ? { ...v, fit: next } : v));
          }}
          onRetake={retake}
          onDone={() => void closeThisTab()}
          reader={reader}
          readerJob={readerJob}
          onReaderPoints={(next) => {
            setReader(next);
            void saveReader(next);
          }}
          onReader={openAi}
        />
      </div>
    );
  }

  const parts = steps.length ? partsFor(steps) : PARTS;
  const currentPart = view.kind === 'intro' || view.kind === 'task' ? PART_OF[view.step] : null;

  let body: JSX.Element;
  if (view.kind === 'welcome') {
    body = <Welcome onStart={start} onSkip={() => void skipAll()} />;
  } else if (view.kind === 'task' && view.step === 'context') {
    body = (
      <ContextTask
        key="context"
        onImport={startReaderImport}
        onDone={() => stepDone('context', { trials: 1 })}
        onSkip={() => skipStep('context')}
      />
    );
  } else if (view.kind === 'task') {
    const step = view.step as Exclude<StepId, 'context'>;
    const Task = TASKS[step];
    body = (
      <Task
        key={step}
        raw={raw}
        env={env}
        settings={settings}
        draft={draft}
        rng={rng}
        input={raw.inputClass}
        onAnswer={onAnswer}
        onDone={(o) => stepDone(step, o)}
      />
    );
  } else if (view.kind === 'intro') {
    // The step's empty stage waits behind the card, so Start reveals it in place.
    body = (
      <TaskLayout title={wordsFor(view.step, raw.inputClass).title} stageClass={STAGE_CLASS[view.step]} actions={<span class="fl-actions-ghost" />} />
    );
  } else {
    body = (
      <section class="fl-closing card">
        <span class="fl-closing-mark" aria-hidden="true">
          <CheckIcon size={36} />
        </span>
        <h2 class="fl-closing-title">You’re all set.</h2>
        <p class="fl-closing-deck">Here’s what we found.</p>
      </section>
    );
  }

  const intro = view.kind === 'intro' ? view.step : null;
  const setLine = intro && prev && touchedParts.current.has(PART_OF[prev]) ? partSetLine(prev, intro) : null;

  return (
    <div class="fl-app">
      <TopBar parts={parts} current={currentPart} done={doneParts} ticking={ticking} onSkip={view.kind === 'welcome' || view.kind === 'closing' ? null : () => void skipAll()} />
      <main class="fl-main">
        <div class="fl-col" inert={intro != null}>
          {body}
        </div>
      </main>
      {intro ? (
        <div class="fl-scrim">
          <Instruction
            step={intro}
            eyebrow={eyebrowFor(intro, steps)}
            words={wordsFor(intro, raw.inputClass)}
            setLine={setLine}
            onStart={() => beginStep(intro)}
            onSkip={() => skipStep(intro)}
          />
        </div>
      ) : null}
      <div class="visually-hidden" aria-live="polite">
        {announce}
      </div>
    </div>
  );
}
