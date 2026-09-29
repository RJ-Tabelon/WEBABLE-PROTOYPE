'use client';

import type { FitProfile } from '@webable/core';
import {
  type FitRow,
  type FitRowId,
  fitRows,
} from '@webable/core/profile/describe';
import { Button, useToast } from '@webable/ui';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';

import type { AdjustedFit } from '../../../app/app/actions';
import { adjustFitAction } from '../../../app/app/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { nudgeExtension } from '../../../lib/extension/bridge';
import { writeFitUi } from '../../shell/fit-ui';
import { AppSection } from '../PageHead';
import type { AdjustInput, AdjustValue } from './adjust';
import { FitReadout } from './FitReadout';
import { RowEditor } from './RowEditor';
import { fitUiFor, toFitUiInput } from './ui';

export interface FitDocumentProps {
  profile: FitProfile;
  version: number;
  /** Server "now", so the source line ("Measured today") renders the same everywhere. */
  now: string;
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

function moduleFact(
  status: FitProfile['modules'][Module],
  rows: FitRow[],
): string {
  const changing = rows.filter((r) => r.changesPages).length;
  const tuned =
    status === 'measured'
      ? 'Measured in Tune'
      : status === 'skipped'
        ? 'Skipped in Tune'
        : 'Not tuned yet';
  if (changing === 0) return `${tuned} · pages stay as sites made them`;
  return `${tuned} · ${changing} of ${rows.length} settings change pages`;
}

function rowValue(profile: FitProfile, id: FitRowId): string {
  return fitRows(profile).find((r) => r.id === id)?.after ?? '';
}

/**
 * "Your fit" rows (design-final §9.4): label, one plain sentence, a Mono readout
 * from the browser's default to this fit, where the value came from, and Adjust.
 * Saving writes a new version and offers Undo in a toast.
 */
export function FitDocument({
  profile: initialProfile,
  version: initialVersion,
  now,
}: FitDocumentProps) {
  const router = useRouter();
  const toast = useToast();
  const [fit, setFit] = useState({
    profile: initialProfile,
    version: initialVersion,
  });
  const [editing, setEditing] = useState<FitRowId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const adjustRefs = useRef(new Map<FitRowId, HTMLButtonElement>());

  // A newer version from the server (another tab, a Tune) replaces local state.
  useEffect(() => {
    setFit((current) =>
      initialVersion > current.version
        ? { profile: initialProfile, version: initialVersion }
        : current,
    );
  }, [initialProfile, initialVersion]);

  const rows = useMemo(
    () => fitRows(fit.profile, undefined, { now: new Date(now) }),
    [fit.profile, now],
  );
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);

  function close(row: FitRowId) {
    setEditing(null);
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

  async function save(row: FitRow, input: AdjustInput) {
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
    const label = row.label;
    const value = rowValue(result.profile, row.id);
    toast.show({
      message: `${label} is now ${value}.`,
      applied: true,
      action: {
        label: 'Undo',
        onAction: () => void undo(row, result.previousVersion),
      },
    });
  }

  async function undo(row: FitRow, fromVersion: number) {
    const result = await run({ kind: 'restore', row: row.id, fromVersion });
    if (typeof result === 'string') {
      toast.show({ message: `Couldn’t undo. ${result}` });
      return;
    }
    applied(result);
    toast.show({
      message: `${row.label} is back to ${rowValue(result.profile, row.id)}.`,
    });
  }

  return (
    <>
      {GROUPS.map((group) => {
        const groupRows = group.rows
          .map((id) => byId.get(id))
          .filter((r): r is FitRow => !!r);
        return (
          <AppSection
            key={group.module}
            id={`fit-${group.module}`}
            title={group.title}
            eyebrow={moduleFact(fit.profile.modules[group.module], groupRows)}
          >
            <ul role="list" className="wa-rows">
              {groupRows.map((row) => {
                const open = editing === row.id;
                const editorId = `fit-editor-${row.id}`;
                const labelId = `fit-row-${row.id}`;
                return (
                  <li key={row.id} className="wa-fit-row">
                    <div className="wa-fit-row__text">
                      <h3 id={labelId} className="wa-fit-row__label">
                        {row.label}
                      </h3>
                      <p className="wa-fit-row__sentence">{row.sentence}</p>
                      <p className="wa-fit-row__source">
                        {row.source}
                        {row.sourceKind === 'measured' &&
                        row.confidence === 'low'
                          ? ' · a rough measure'
                          : ''}
                      </p>
                    </div>
                    <div className="wa-fit-row__value">
                      <FitReadout
                        before={row.before}
                        after={row.after}
                        srText={row.srText}
                        changed={row.changed}
                      />
                    </div>
                    <Button
                      ref={(el) => {
                        if (el) adjustRefs.current.set(row.id, el);
                        else adjustRefs.current.delete(row.id);
                      }}
                      variant="ghost"
                      size="md"
                      className="wa-fit-row__adjust"
                      aria-expanded={open}
                      aria-controls={open ? editorId : undefined}
                      disabled={saving && !open}
                      onClick={() => {
                        if (open) close(row.id);
                        else {
                          setError(null);
                          setEditing(row.id);
                        }
                      }}
                    >
                      {/* A disclosure: the label stays, aria-expanded says whether it is open. */}
                      Adjust
                      <span className="sr-only">
                        {' '}
                        {row.label.toLowerCase()}
                      </span>
                    </Button>
                    {open ? (
                      <RowEditor
                        id={editorId}
                        row={row}
                        profile={fit.profile}
                        busy={saving}
                        error={error}
                        onSave={(value: AdjustValue) =>
                          void save(row, { kind: 'set', change: value })
                        }
                        onUseMeasured={() => {
                          if (row.id === 'motion' || row.id === 'busyPages')
                            return;
                          void save(row, { kind: 'measured', row: row.id });
                        }}
                        onCancel={() => close(row.id)}
                      />
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </AppSection>
        );
      })}
    </>
  );
}
