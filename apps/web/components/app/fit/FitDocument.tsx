'use client';

import type { FitProfile } from '@webable/core';
import {
  type FitRow as CoreFitRow,
  type FitRowId,
  fitRows,
} from '@webable/core/profile/describe';
import { Button, FitRow, useToast } from '@webable/ui';
import { useRouter } from 'next/navigation';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

import type { AdjustedFit } from '../../../app/app/actions';
import { adjustFitAction, resetLearnedAction } from '../../../app/app/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { nudgeExtension } from '../../../lib/extension/bridge';
import { writeFitUi } from '../../shell/fit-ui';
import { FitPreview } from '../../tune/fit/FitPreview';
import type { LearnedDim } from '../changes/learned';
import { AppSection } from '../PageHead';
import {
  type AdjustInput,
  type AdjustValue,
  applyValue,
  currentValue,
  isParamRow,
  measuredAlternative,
  sameValue,
} from './adjust';
import { learnedOverrides } from './learned-fit';
import { RowEditor } from './RowEditor';
import { fitUiFor, toFitUiInput } from './ui';
import { fitValueOf } from './value';

export interface FitDocumentProps {
  profile: FitProfile;
  version: number;
  /** Server "now", so the source line ("Measured today") renders the same everywhere. */
  now: string;
  /** The page head (eyebrow, h1, deck, this-browser status), set beside the preview. */
  head: ReactNode;
  /** Values WebAble settled on as you browse (from the synced learning state). */
  learned: readonly LearnedDim[];
}

type Module = 'reading' | 'pointing' | 'focus';

const GROUPS: ReadonlyArray<{
  module: Module;
  title: string;
  rows: readonly FitRowId[];
}> = [
  {
    module: 'reading',
    title: 'Reading',
    rows: ['textSize', 'contrast', 'polarity', 'lineSpacing', 'lineLength'],
  },
  {
    module: 'pointing',
    title: 'Pointing',
    rows: ['targets', 'steadyClicks', 'hoverGrace'],
  },
  { module: 'focus', title: 'Focus', rows: ['motion', 'busyPages'] },
];

/** The preview renders at the browser's default size; the fit's own values do the rest. */
const PREVIEW_ROOT_PX = 16;

function moduleFact(
  status: FitProfile['modules'][Module],
  rows: CoreFitRow[],
): string {
  const changing = rows.filter((r) => r.changesPages).length;
  const tuned =
    status === 'measured'
      ? 'Measured in Tune'
      : status === 'skipped'
        ? 'Skipped in Tune'
        : 'Not tuned yet';
  // One line on a phone: the rows below say what each setting does.
  if (changing === 0) return `${tuned} · no changes`;
  return `${tuned} · ${changing} of ${rows.length} change pages`;
}

function rowAfter(profile: FitProfile, id: FitRowId): string {
  return fitRows(profile).find((r) => r.id === id)?.after ?? '';
}

/**
 * "Your fit" (design-final §9.4, Working density): rows with the value WebAble
 * uses, where it came from, and Adjust, beside a live preview of a sample page
 * that follows the editor's draft. Saving writes a new version and offers Undo;
 * a value learned as you browse shows here, with a way back to the fit's own.
 */
export function FitDocument({
  profile: initialProfile,
  version: initialVersion,
  now,
  head,
  learned: initialLearned,
}: FitDocumentProps) {
  const router = useRouter();
  const toast = useToast();
  const [fit, setFit] = useState({
    profile: initialProfile,
    version: initialVersion,
  });
  const [learned, setLearned] = useState(initialLearned);
  const [editing, setEditing] = useState<FitRowId | null>(null);
  const [draft, setDraft] = useState<AdjustValue | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<FitRowId | null>(null);
  const adjustRefs = useRef(new Map<FitRowId, HTMLButtonElement>());

  // A newer version from the server (another tab, a Tune, a restore) replaces local state.
  useEffect(() => {
    setFit((current) =>
      initialVersion > current.version
        ? { profile: initialProfile, version: initialVersion }
        : current,
    );
  }, [initialProfile, initialVersion]);
  useEffect(() => setLearned(initialLearned), [initialLearned]);

  const today = useMemo(() => new Date(now), [now]);
  const rows = useMemo(
    () => fitRows(fit.profile, undefined, { now: today }),
    [fit.profile, today],
  );
  const draftProfile = useMemo(
    () => (draft ? applyValue(fit.profile, draft) : null),
    [draft, fit.profile],
  );
  const draftRows = useMemo(
    () =>
      draftProfile ? fitRows(draftProfile, undefined, { now: today }) : null,
    [draftProfile, today],
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const draftById = useMemo(
    () => new Map((draftRows ?? []).map((r) => [r.id, r])),
    [draftRows],
  );
  const overrides = useMemo(
    () => learnedOverrides(fit.profile, rows, learned),
    [fit.profile, rows, learned],
  );

  function close(row: FitRowId) {
    setEditing(null);
    setDraft(null);
    setError(null);
    requestAnimationFrame(() => adjustRefs.current.get(row)?.focus());
  }

  function applied(result: AdjustedFit) {
    setFit({ profile: result.profile, version: result.version });
    // WebAble's own UI and the extension pick up the new fit now.
    writeFitUi(toFitUiInput(fitUiFor(result.profile)));
    void nudgeExtension();
    router.refresh();
  }

  async function run(input: AdjustInput): Promise<AdjustedFit | string> {
    try {
      const result = await adjustFitAction(input);
      return result.ok ? result.data : result.error.message;
    } catch {
      return DATA_ERROR_MESSAGES.unavailable;
    }
  }

  async function save(row: CoreFitRow, input: AdjustInput) {
    setSaving(true);
    setError(null);
    const result = await run(input);
    setSaving(false);
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    applied(result);
    close(row.id);
    toast.show({
      message: `${row.label} is now ${rowAfter(result.profile, row.id)}.`,
      applied: true,
      action: {
        label: 'Undo',
        onAction: () => void undo(row, result.previousVersion),
      },
    });
  }

  async function undo(row: CoreFitRow, fromVersion: number) {
    const result = await run({ kind: 'restore', row: row.id, fromVersion });
    if (typeof result === 'string') {
      toast.show({ message: `Couldn’t undo. ${result}` });
      return;
    }
    applied(result);
    toast.show({
      message: `${row.label} is back to ${rowAfter(result.profile, row.id)}.`,
    });
  }

  /** [Use 18 px]: forget the learned value, so the fit's own applies again. */
  async function backToFit(row: CoreFitRow) {
    const override = overrides.get(row.id);
    if (!override) return;
    setResetting(row.id);
    let message: string | null = null;
    try {
      const result = await resetLearnedAction({ keys: [override.dim] });
      if (!result.ok) message = result.error.message;
    } catch {
      message = DATA_ERROR_MESSAGES.unavailable;
    }
    setResetting(null);
    if (message) {
      toast.show({ message: `Nothing changed. ${message}` });
      return;
    }
    setLearned((list) => list.filter((d) => d.dim !== override.dim));
    void nudgeExtension();
    toast.show({
      message: `${row.label} is back to ${override.fitShown}.`,
      applied: true,
    });
    requestAnimationFrame(() => adjustRefs.current.get(row.id)?.focus());
  }

  const preview = (
    <FitPreview
      profile={draftProfile ?? fit.profile}
      rows={draftRows ?? rows}
      rootFontPx={PREVIEW_ROOT_PX}
    />
  );

  function rowView(row: CoreFitRow) {
    const open = editing === row.id;
    const editorId = `fit-editor-${row.id}`;
    const labelId = `fit-row-${row.id}`;
    const override = overrides.get(row.id);
    const draftRow = open ? draftById.get(row.id) : undefined;
    const value = draftRow
      ? fitValueOf(draftRow)
      : override
        ? override.value
        : fitValueOf(row);
    // A learned value keeps the fit's own one a click away, on the source
    // line, so the Adjust column (and the value column) stay put in every row.
    const source = override ? (
      <>
        <span>{override.source}</span>
        {!open ? (
          <Button
            variant="ghost"
            size="sm"
            flush="start"
            className="wa-fit-learned__use"
            busy={resetting === row.id}
            busyLabel="Going back…"
            disabled={saving}
            onClick={() => void backToFit(row)}
          >
            {override.useLabel}
            <span className="sr-only"> for {row.label.toLowerCase()}</span>
          </Button>
        ) : null}
      </>
    ) : (
      `${row.source}${
        row.sourceKind === 'measured' && row.confidence === 'low'
          ? ' · a rough measure'
          : ''
      }`
    );
    const measured = measuredAlternative(fit.profile, row.id);

    return (
      <FitRow
        key={row.id}
        as="li"
        density="working"
        headingLevel={3}
        labelId={labelId}
        label={row.label}
        sentence={row.sentence}
        source={source}
        value={value}
        changed={value.kind !== 'same' || Boolean(override)}
        action={
          <Button
            ref={(el: HTMLButtonElement | null) => {
              if (el) adjustRefs.current.set(row.id, el);
              else adjustRefs.current.delete(row.id);
            }}
            variant="ghost"
            size="md"
            flush="end"
            iconStart="sliders-horizontal"
            aria-expanded={open}
            aria-controls={open ? editorId : undefined}
            disabled={saving && !open}
            onClick={() => {
              if (open) close(row.id);
              else {
                setError(null);
                setDraft(null);
                setEditing(row.id);
              }
            }}
          >
            {/* A disclosure: the label stays, aria-expanded says whether it is open. */}
            Adjust
            <span className="sr-only"> {row.label.toLowerCase()}</span>
          </Button>
        }
        editor={
          open ? (
            <RowEditor
              id={editorId}
              row={row}
              value={currentValue(fit.profile, row.id)}
              mode="save"
              labelledBy={labelId}
              busy={saving}
              error={error}
              measured={measured}
              systemReducedMotion={fit.profile.attention.systemReducedMotion}
              onDraft={setDraft}
              onCommit={(next) => {
                if (sameValue(next, currentValue(fit.profile, row.id)))
                  close(row.id);
                else void save(row, { kind: 'set', change: next });
              }}
              onUseMeasured={
                measured && isParamRow(row.id)
                  ? () => {
                      if (isParamRow(row.id))
                        void save(row, { kind: 'measured', row: row.id });
                    }
                  : undefined
              }
              onCancel={() => close(row.id)}
            />
          ) : undefined
        }
      />
    );
  }

  return (
    <>
      <div className="wa-fit-top">
        <div className="wa-fit-top__head">{head}</div>
        <div className="wa-fit-top__preview">{preview}</div>
      </div>
      {GROUPS.map((group) => {
        const groupRows = group.rows
          .map((id) => byId.get(id))
          .filter((r): r is CoreFitRow => !!r);
        return [
          <AppSection
            key={group.module}
            id={`fit-${group.module}`}
            title={group.title}
            eyebrow={moduleFact(fit.profile.modules[group.module], groupRows)}
          >
            <ul role="list" className="wa-fitrows">
              {groupRows.map(rowView)}
            </ul>
          </AppSection>,
          // Below 48em the preview follows the rows it shows first.
          group.module === 'reading' ? (
            <div key="preview-narrow" className="wa-fit-preview-narrow">
              {preview}
            </div>
          ) : null,
        ];
      })}
    </>
  );
}
