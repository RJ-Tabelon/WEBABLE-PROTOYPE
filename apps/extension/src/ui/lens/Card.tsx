// Owner: L. The Lens card (304 px) for one element: what it is, what WebAble did, Jev's probabilities, and the
// policy comparisons that decided it. Opens on hover (hit-tested by the Lens), on row focus, or pinned by a click.
import type { Ref } from 'preact';
import { POLICY, type Role } from '@webable/core';
import { ROLE_GROUP, ROLE_NAME, type LensItem } from './display';
import { ClassIcon, IClose } from './icons';
import { fineRoleBars, importanceWord } from './words';

const f2 = (p: number): string => (Number.isFinite(p) ? Math.min(1, Math.max(0, p)).toFixed(2) : '0.00');
const pct = (p: number): string => `${Math.round(Math.min(1, Math.max(0, p)) * 1000) / 10}%`;

interface Zone { from: number; to: number; kind: 'fold' | 'protect' | 'main' | 'gap' }

function Track(props: { name: string; value: number; ticks: number[]; zones: Zone[] }) {
  const { name, value, ticks, zones } = props;
  return (
    <div class="wa-lt">
      <span class="wa-lt-name">{name}</span>
      <span class="wa-lt-track" aria-hidden="true">
        {zones.map((z) => (
          <i key={`${z.kind}${z.from}`} class="wa-lt-zone" data-k={z.kind} style={{ left: pct(z.from), width: pct(z.to - z.from) }} />
        ))}
        {ticks.map((t) => (
          <i key={`t${t}`} class="wa-lt-tick" style={{ left: pct(t) }} />
        ))}
        <i class="wa-lt-dot" style={{ left: pct(value) }} />
      </span>
      <b class="wa-lt-v">{f2(value)}</b>
    </div>
  );
}

function SumBar(props: { name: string; value: number; at: number; act: string; kind: 'fold' | 'protect'; hit: boolean }) {
  const { name, value, at, act, kind, hit } = props;
  return (
    <div class="wa-ls" data-k={kind} data-hit={String(hit)}>
      <span class="wa-ls-name">{name}</span>
      <b class="wa-ls-v">{f2(value)}</b>
      <span class="wa-ls-bar" aria-hidden="true">
        <i class="wa-ls-fill" style={{ width: pct(value) }} />
        <i class="wa-ls-tick" style={{ left: pct(at) }} />
      </span>
      <span class="wa-ls-act">
        {act} {f2(at)}
      </span>
    </div>
  );
}

export interface CardProps {
  item: LensItem;
  pinned: boolean;
  /** "Covered by a chat panel" when probes found the element under something else. */
  covered: string | null;
  onClose: () => void;
  cardRef: Ref<HTMLDivElement>;
}

export function Card({ item, pinned, covered, onClose, cardRef }: CardProps) {
  const j = item.j;
  const answered = Boolean(j && (j.roleP > 0 || Object.keys(j.roleProbs ?? {}).length > 0));
  const roles = answered && j
    ? (Object.entries(j.roleProbs) as Array<[Role, number]>)
        .filter(([, p]) => typeof p === 'number' && p > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
    : [];
  const task = j?.task ?? 0;
  const main = j?.main ?? 0;
  const help = j?.help ?? 0;
  const foldHit = item.cls === 'folded' || (item.foldSum >= POLICY.foldRoleSum);
  const protectHit = item.protectSum >= POLICY.protectRoleSum && item.cls !== 'folded';
  const numText = item.num ? ` ${item.num}` : '';
  const fineBars = fineRoleBars(j);
  const importance = item.importance;

  return (
    <div
      class="wa-lcard"
      data-c={item.cls}
      data-pinned={String(pinned)}
      ref={cardRef}
      role={pinned ? 'dialog' : 'tooltip'}
      aria-label={`Jev on “${item.label}”`}
    >
      <div class="wa-lcard-top">
        <span class="wa-lcard-badge" data-c={item.cls}>
          <ClassIcon cls={item.cls} size={12} />
          <span>{item.chip}</span>
          {numText && <b>{numText}</b>}
        </span>
        {pinned && (
          <button class="wa-lcard-x" aria-label="Close" onClick={onClose}>
            <IClose size={14} />
          </button>
        )}
      </div>
      <h4 class="wa-lcard-title">“{item.label}”</h4>
      <p class="wa-lcard-where">{item.where}</p>
      {covered && <p class="wa-lcard-covered">{covered}: chip hidden, outline dashed.</p>}
      <p class="wa-lcard-verdict">{item.sentence}</p>

      {answered && j ? (
        <>
          <div class="wa-lcard-h">Jev's probability for each role</div>
          <div class="wa-lroles">
            {roles.map(([r, p]) => (
              <div class="wa-lrole" key={r} data-g={ROLE_GROUP[r]}>
                <span class="wa-lrole-n">{ROLE_NAME[r]}</span>
                <span class="wa-lrole-bar" aria-hidden="true">
                  <i style={{ width: pct(Math.max(0.015, p)) }} />
                </span>
                <b class="wa-lrole-v">{f2(p)}</b>
              </div>
            ))}
          </div>

          <div class="wa-lcard-h">Group sums the policy reads</div>
          <SumBar name="Ads, teasers, popups" value={item.foldSum} at={POLICY.foldRoleSum} act="fold" kind="fold" hit={foldHit} />
          <SumBar name="Content, controls, help" value={item.protectSum} at={POLICY.protectRoleSum} act="protect" kind="protect" hit={protectHit} />

          <div class="wa-lcard-h">Yes/no answers</div>
          <Track
            name="task"
            value={task}
            ticks={[POLICY.foldTaskMax, POLICY.protectTask]}
            zones={[
              { from: 0, to: POLICY.foldTaskMax, kind: 'fold' },
              { from: POLICY.foldTaskMax, to: POLICY.protectTask, kind: 'gap' },
              { from: POLICY.protectTask, to: 1, kind: 'protect' },
            ]}
          />
          <Track name="main" value={main} ticks={[POLICY.promoteMainNoul]} zones={[{ from: POLICY.promoteMainNoul, to: 1, kind: 'main' }]} />
          <Track
            name="help"
            value={help}
            ticks={[POLICY.foldHelpMax, POLICY.protectHelp]}
            zones={[
              { from: 0, to: POLICY.foldHelpMax, kind: 'fold' },
              { from: POLICY.foldHelpMax, to: POLICY.protectHelp, kind: 'gap' },
              { from: POLICY.protectHelp, to: 1, kind: 'protect' },
            ]}
          />
          <div class="wa-lt-legend" aria-hidden="true">
            <span><i data-k="fold" /> may fold</span>
            <span><i data-k="gap" /> not sure: left alone</span>
            <span><i data-k="protect" /> protect</span>
          </div>
        </>
      ) : (
        <p class="wa-lcard-none">{item.cls === 'pending' ? 'Jev has not answered yet.' : 'Jev did not answer for this element.'}</p>
      )}

      {fineBars.length > 0 && (
        <>
          <div class="wa-lcard-h">Fine role · Jev's probability</div>
          <div class="wa-lroles">
            {fineBars.map((bar) => (
              <div class="wa-lrole" key={bar.role} data-g={bar.family} data-fine="true">
                <span class="wa-lrole-n" title={bar.name}>{bar.name}</span>
                <span class="wa-lrole-bar" aria-hidden="true">
                  <i style={{ width: pct(Math.max(0.015, bar.p)) }} />
                </span>
                <b class="wa-lrole-v">{f2(bar.p)}</b>
              </div>
            ))}
          </div>
        </>
      )}

      {importance != null && (
        <p class="wa-limp" data-w={item.weight ?? undefined}>
          <span class="wa-limp-k">Importance</span>
          <span class="wa-limp-meter" aria-hidden="true">
            {[1, 2, 3, 4].map((step) => (
              <i key={step} data-on={String(step <= importance)} />
            ))}
          </span>
          <b>{importance} of 4 · {importanceWord(importance)}</b>
        </p>
      )}

      {item.because.length > 0 && (
        <p class="wa-lcard-because">
          <span>Because</span> {item.because.join(' · ')}
        </p>
      )}
    </div>
  );
}

