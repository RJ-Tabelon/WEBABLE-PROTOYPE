'use client';

import {
  Actions,
  Button,
  CheckGlyph,
  Dialog,
  ErrorPanel,
  useToast,
} from '@webable/ui';
import { useState } from 'react';

import {
  deleteMyAccountAction,
  exportMyDataAction,
} from '../../../lib/data/actions';
import { DATA_ERROR_MESSAGES } from '../../../lib/data/result';
import { extension, getBridge } from '../../../lib/extension/bridge';
import { useExtension } from '../../../lib/extension/useExtension';
import { clearFitUi } from '../../shell/fit-ui';
import { LOCAL_CLEARED_EVENT } from './Receipts';

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
 * Your data, top to bottom: clear what WebAble keeps in this browser (when it's
 * here), download everything saved with the account (export_my_data, as a JSON
 * file), and delete the account (a danger dialog with explicit verbs; nothing
 * is deleted until the filled button is pressed). Deleting also empties and
 * signs out WebAble in this browser.
 */
export function DataControls() {
  const { state } = useExtension({ recheckOnFocus: false });
  const toast = useToast();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
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

  async function onClearLocal() {
    setClearBusy(true);
    setClearError(null);
    const result = await extension.clearLocal();
    setClearBusy(false);
    if (!result.ok) {
      setClearError(result.error.message);
      return;
    }
    setClearing(false);
    window.dispatchEvent(new Event(LOCAL_CLEARED_EVENT));
    toast.show({ message: 'Cleared what WebAble kept in this browser.' });
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
    // The account is gone. Empty WebAble in this browser (its copy of the fit,
    // what it learned, its site settings), then sign it out.
    if (getBridge().available()) {
      await extension.clearLocal({ timeoutMs: 3000 }).catch(() => undefined);
      await extension.disconnect({ timeoutMs: 3000 }).catch(() => undefined);
    }
    clearFitUi();
    window.location.assign('/sign-in?deleted=1');
  }

  const installed = state.phase === 'ready';

  return (
    <>
      {installed ? (
        <div className="wa-danger-row">
          <div>
            <p className="wa-row__label">Clear this browser’s WebAble data</p>
            <p className="wa-row__detail">
              Removes site settings, what was sent, and WebAble’s copy of your
              fit from this browser. Your account keeps everything saved to it.
            </p>
          </div>
          <div>
            <Button variant="danger" onClick={() => setClearing(true)}>
              Clear this browser
            </Button>
          </div>
        </div>
      ) : null}

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
      {exportError && !confirming ? (
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
        open={clearing}
        onOpenChange={(open) => {
          if (!open && !clearBusy) setClearing(false);
        }}
        title="Clear this browser’s WebAble data?"
        description="WebAble removes its site settings, the list of what was sent, and its copy of your fit and what it learned from this browser. This can’t be undone. Your account and everything saved to it stay."
        actions={
          <Actions>
            <Button
              variant="danger-filled"
              busy={clearBusy}
              busyLabel="Clearing…"
              onClick={() => void onClearLocal()}
            >
              Clear this browser
            </Button>
            <Button
              variant="secondary"
              disabled={clearBusy}
              onClick={() => setClearing(false)}
            >
              Keep it
            </Button>
          </Actions>
        }
      >
        {clearError ? (
          <ErrorPanel title="Nothing was cleared" live as="p">
            <p>{clearError}</p>
          </ErrorPanel>
        ) : null}
      </Dialog>

      <Dialog
        open={confirming}
        onOpenChange={(open) => {
          if (!open && !deleting) setConfirming(false);
        }}
        title="Delete your account?"
        description="This deletes your account, your fit and its history, and everything WebAble stored for you. It can’t be undone. WebAble in this browser is emptied and signed out."
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
          Want a copy first?{' '}
          <button
            type="button"
            className="wa-link wa-link-button"
            aria-busy={exporting || undefined}
            onClick={() => void onExport()}
          >
            {exporting ? 'Preparing your data…' : 'Download your data'}
          </button>
          {exported ? ` Saved ${exported}.` : ''}
        </p>
        {exportError ? (
          <p className="wa-reason" role="alert">
            Your data wasn’t downloaded. {exportError}
          </p>
        ) : null}
        {deleteError ? (
          <ErrorPanel title="Your account wasn’t deleted" live as="p">
            <p>{deleteError}</p>
          </ErrorPanel>
        ) : null}
      </Dialog>
    </>
  );
}
