// F1–F3 on real websites (docs/design/ONBOARDING.md, round 8c, point 4). The background opens three real sites, one
// after another, in a task tab where WebAble stays off; this tab waits calmly ("We've opened Wikipedia in a new tab.")
// and comes back to the front when the last one is done. Then two quick questions: which site was easier to find
// things on, and did anything get in the way. Fills finding (one trial per site), allPresses (every press on the
// sites) and raw.sites (for the results page's evidence). Nothing here tells the person how they did.

import type { JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import type { SiteTaskResult, SiteTaskSpec } from '../../../src/sitetask/types';
import { siteTrial } from '../logic/raw';
import { runSiteTasks, SITE_TASKS } from '../logic/sites';
import { IN_THE_WAY } from '../logic/steps';
import { CheckIcon } from '../ui/Chrome';
import { useKeys, usePressed } from '../ui/hooks';
import { Answer, TaskLayout, type TaskProps } from './Task';

type Phase = 'running' | 'failed' | 'which' | 'inway';

function looksLikeResult(x: unknown): x is SiteTaskResult {
  if (!x || typeof x !== 'object') return false;
  const r = x as Partial<SiteTaskResult>;
  return typeof r.id === 'string' && typeof r.name === 'string' && typeof r.found === 'boolean' && typeof r.busy === 'boolean';
}

export function SitesTask(props: TaskProps): JSX.Element {
  const { raw } = props;
  const specs: readonly SiteTaskSpec[] = SITE_TASKS;
  const total = Math.max(1, specs.length);
  const [phase, setPhase] = useState<Phase>('running');
  const got = useRef(new Map<string, SiteTaskResult>());
  const [done, setDone] = useState(0);
  const settled = useRef(false);
  const alive = useRef(true);
  const [pressed, press] = usePressed();
  const [chips, setChips] = useState<string[]>([]);
  const [nothing, setNothing] = useState(false);
  const [names, setNames] = useState<{ quiet: string; busy: string }>({ quiet: 'Wikipedia', busy: 'CNN' });
  const askedWhich = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  /** A site finished part-way through the run (the count shown; 0 < n < total means the sites really opened). */
  const progressed = useRef(false);
  const onProgress = (n: number) => {
    if (settled.current || !Number.isFinite(n)) return;
    if (n > 0 && n < total) progressed.current = true;
    setDone((d) => Math.min(total, Math.max(d, Math.floor(n), got.current.size)));
  };

  /** The sites are over (all done, closed early, or skipped): keep what we have and ask the two questions. */
  const finishSites = (results: SiteTaskResult[] | null, byPerson: boolean) => {
    if (settled.current || !alive.current) return;
    settled.current = true;
    const list = (results && results.length ? results : [...got.current.values()]).filter(looksLikeResult);
    const trials = raw.addSites(list);
    if (trials > 0) raw.endBlock('find', { trials, stop: byPerson ? 'person' : 'max_trials' });
    else raw.endBlock('find', { trials: 0, skipped: true });
    raw.beginBlock('pick');
    const tried = list.filter((r) => siteTrial(r));
    const quiet = tried.find((r) => !r.busy);
    const busy = tried.find((r) => r.busy);
    if (quiet && busy) {
      setNames({ quiet: quiet.name, busy: busy.name });
      askedWhich.current = true;
      setPhase('which');
    } else if (!byPerson && trials === 0 && !progressed.current && got.current.size === 0) {
      // Every site came back skipped without the run ever moving: they couldn't be opened. Say so plainly.
      setPhase('failed');
    } else {
      setPhase('inway');
    }
  };

  useEffect(() => {
    alive.current = true;
    heading.current?.focus({ preventScroll: true });
    // Each site's result also arrives as a 'done' message from the task tab, so skipping part-way keeps what's done.
    const rt = (globalThis as { chrome?: typeof chrome }).chrome?.runtime;
    const onMessage = (msg: unknown) => {
      const m = msg as { siteTask?: string; result?: unknown } | null;
      if (settled.current || !m || m.siteTask !== 'done' || !looksLikeResult(m.result)) return;
      got.current.set(m.result.id, m.result);
      onProgress(got.current.size);
    };
    try {
      rt?.onMessage?.addListener(onMessage);
    } catch {
      /* not in the extension */
    }
    // runSiteTasks never rejects; it resolves with one result per site once the task tab has closed.
    let run: Promise<SiteTaskResult[]>;
    try {
      run = Promise.resolve(runSiteTasks(SITE_TASKS, (n: number) => onProgress(n)));
    } catch {
      run = Promise.resolve([]);
    }
    run.then(
      (results) => finishSites(Array.isArray(results) ? results : null, false),
      () => finishSites(null, false),
    );
    return () => {
      alive.current = false;
      try {
        rt?.onMessage?.removeListener(onMessage);
      } catch {
        /* fine */
      }
    };
  }, []);

  const which = (choice: 'first' | 'same' | 'second') => {
    press(choice);
    // The first answer is the quiet site, the last the busy one.
    raw.preferredCalm = choice === 'first' ? 2 : 0;
    props.onAnswer();
    setPhase('inway');
  };

  const toggle = (id: string) => {
    setNothing(false);
    setChips((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  };

  const finish = () => {
    raw.notes = nothing ? [] : chips.slice();
    props.onAnswer();
    // The questions asked (core's 'pick' block): "which site" when it was asked, and "in your way".
    props.onDone({ trials: askedWhich.current ? 2 : 1, stop: 'person' });
  };

  useKeys(phase === 'which', (key) => {
    if (key === '1') which('first');
    else if (key === '2') which('same');
    else if (key === '3') which('second');
  });

  if (phase === 'which') {
    return (
      <TaskLayout title="Which site was easier to find things on?" stageClass="is-which" focusTitle>
        <div class="fl-which" role="group" aria-label="Which site was easier to find things on?">
          <Answer id="first" pressed={pressed} onClick={() => which('first')} keys="1">
            {names.quiet}
          </Answer>
          <Answer id="same" kind="quiet" pressed={pressed} onClick={() => which('same')} keys="2">
            About the same
          </Answer>
          <Answer id="second" pressed={pressed} onClick={() => which('second')} keys="3">
            {names.busy}
          </Answer>
        </div>
      </TaskLayout>
    );
  }

  if (phase === 'inway') {
    return (
      <TaskLayout
        title="Did anything get in your way?"
        stageClass="is-inway"
        focusTitle
        actions={
          <button type="button" class="btn btn-primary fl-btn-wide" onClick={finish} data-answer="done-find">
            Done
          </button>
        }
      >
        <div class="fl-chips" role="group" aria-label="Pick any that apply">
          {IN_THE_WAY.map((c) => {
            const on = chips.includes(c.id);
            return (
              <button type="button" class={`fl-toggle ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => toggle(c.id)} data-answer={c.id}>
                {on ? <CheckIcon size={20} /> : null}
                {c.label}
              </button>
            );
          })}
          <button
            type="button"
            class={`fl-toggle ${nothing ? 'is-on' : ''}`}
            aria-pressed={nothing}
            onClick={() => {
              setChips([]);
              setNothing(!nothing);
            }}
            data-answer="nothing"
          >
            {nothing ? <CheckIcon size={20} /> : null}
            Nothing
          </button>
        </div>
      </TaskLayout>
    );
  }

  if (phase === 'failed') {
    return (
      <section class="fl-sites card" data-phase="failed">
        <h2 class="fl-sites-title">We couldn’t open the websites right now.</h2>
        <p class="fl-sites-deck">You can go on without them.</p>
        <div class="fl-sites-actions">
          <button type="button" class="btn btn-primary fl-btn-wide" onClick={() => setPhase('inway')} data-answer="sites-go-on">
            Go on
          </button>
        </div>
      </section>
    );
  }

  // Waiting: the sites are open in another tab. Calm, plain, one line on where they are.
  const at = Math.min(done, total - 1);
  const current = specs[at]?.name ?? 'the website';
  return (
    <section class="fl-sites card" data-phase="running" data-done={done}>
      <p class="fl-sites-count">
        {Math.min(done + 1, total)} of {total}
      </p>
      <h2 class="fl-sites-title" tabIndex={-1} ref={heading}>
        We’ve opened {current} in a new tab.
      </h2>
      <p class="fl-sites-deck">Come back here when you’re done.</p>
      <ol class="fl-sites-list" aria-label="The websites">
        {specs.map((s, i) => {
          const state = i < done ? 'is-done' : i === at ? 'is-current' : 'is-next';
          return (
            <li class={`fl-sites-item ${state}`} aria-current={state === 'is-current' ? 'step' : undefined}>
              <span class="fl-sites-mark" aria-hidden="true">
                {state === 'is-done' ? <CheckIcon size={16} /> : <span class="fl-sites-dot" />}
              </span>
              {s.name}
              {state === 'is-done' ? <span class="visually-hidden">, done</span> : null}
            </li>
          );
        })}
      </ol>
      <div class="fl-sites-actions">
        <button type="button" class="btn-text" onClick={() => finishSites(null, true)} data-answer="skip-sites">
          Skip the websites
        </button>
      </div>
      <span class="visually-hidden" aria-live="polite">{`${Math.min(done + 1, total)} of ${total}: ${current}`}</span>
    </section>
  );
}
