'use client';

import { Actions, Button, CheckGlyph, Dialog, ErrorPanel } from '@webable/ui';
import { useState } from 'react';

import {
  deleteMyAccountAction,
  exportMyDataAction,
} from '../../../lib/data/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { extension, getBridge } from '../../../lib/extension/bridge';
import { clearFitUi } from '../../shell/fit-ui';

/** Save a JSON document as a file, without a server round trip. */
export function downloadJson(document_: unknown, filename: string): void {
  const blob = new Blob([`${JSON.stringify(document_, null, 2)}\n`], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Give the browser a moment to start the download before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * "Download my data" (export_my_data, as a JSON file) and "Delete my account"
 * (a danger dialog with explicit verbs; nothing is deleted until the filled
 * button is pressed).
 */
export function DataControls() {
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  async function onExport() {
    setExporting(true);
    setExportError(null);
    setExported(null);
    try {
      const result = await exportMyDataAction();
      if (!result.ok) setExportError(result.error.message);
      else {
        downloadJson(result.data.document, result.data.filename);
        setExported(result.data.filename);
      }
    } catch {
      setExportError(DATA_ERROR_MESSAGES.unavailable);
    }
    setExporting(false);
  }

  async function onDelete() {
    setDeleting(true);
    setDeleteError(null);
    try {
      const result = await deleteMyAccountAction();
      if (!result.ok) {
        setDeleteError(result.error.message);
        setDeleting(false);
        return;
      }
    } catch {
      setDeleteError(DATA_ERROR_MESSAGES.unavailable);
      setDeleting(false);
      return;
    }
    // The account is gone. Sign this browser's extension out and forget the UI fit.
    if (getBridge().available())
      await extension.disconnect({ timeoutMs: 3000 }).catch(() => undefined);
    clearFitUi();
    window.location.assign('/sign-in?deleted=1');
  }

  return (
    <>
      <div className="wa-danger-row">
        <div>
          <p className="wa-row__label">Download my data</p>
          <p className="wa-row__detail">
            One JSON file with your fit and its history, Tune summaries, what
            WebAble learned, weekly counts and connected browsers. Sites stay in
            the extension.
          </p>
          {exported ? (
            <p className="wa-app-form__done" role="status">
              <CheckGlyph size={16} />
              <span>Saved {exported}.</span>
            </p>
          ) : null}
        </div>
        <div>
          <Button
            variant="secondary"
            onClick={() => void onExport()}
            busy={exporting}
            busyLabel="Preparing…"
          >
            Download my data
          </Button>
        </div>
      </div>
      {exportError ? (
        <ErrorPanel title="Couldn’t prepare your data" live as="h3">
          <p>{exportError}</p>
        </ErrorPanel>
      ) : null}

      <div className="wa-danger-row">
        <div>
          <p className="wa-row__label">Delete my account</p>
          <p className="wa-row__detail">
            Deletes your account, your fit and its history, and everything
            WebAble stored for you.
          </p>
        </div>
        <div>
          <Button variant="danger" onClick={() => setConfirming(true)}>
            Delete my account
          </Button>
        </div>
      </div>

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirming(false);
        }}
        title="Delete your account?"
        description="This deletes your account, your fit and its history, and everything WebAble stored for you. It can’t be undone. WebAble in this browser is signed out."
        actions={
          <Actions>
            <Button
              variant="danger-filled"
              busy={deleting}
              busyLabel="Deleting…"
              onClick={() => void onDelete()}
            >
              Delete my account
            </Button>
            <Button
              variant="secondary"
              disabled={deleting}
              onClick={() => setConfirming(false)}
            >
              Keep my account
            </Button>
          </Actions>
        }
      >
        <p className="wa-app-meta">
          Want a copy first? Download your data before you delete.
        </p>
        {deleteError ? (
          <ErrorPanel title="Your account wasn’t deleted" live as="p">
            <p>{deleteError}</p>
          </ErrorPanel>
        ) : null}
      </Dialog>
    </>
  );
}
