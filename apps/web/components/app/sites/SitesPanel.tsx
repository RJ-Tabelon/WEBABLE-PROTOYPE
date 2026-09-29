'use client';

import type { LocalSite } from '@webable/core';
import {
  Actions,
  Button,
  Dialog,
  EmptyState,
  ErrorPanel,
  Icon,
  StatusGlyph,
  StatusPill,
  TextField,
  TextLink,
  useToast,
} from '@webable/ui';
import { useCallback, useEffect, useState } from 'react';

import { type BridgeFailure, extension } from '../../../lib/extension/bridge';
import { connectView } from '../../../lib/extension/state';
import { useExtension } from '../../../lib/extension/useExtension';
import { formatRelativeDay, plural } from '../format';
import {
  applyLocally,
  FILTER_AFTER,
  filterSites,
  opLabels,
  type SiteChange,
  sortSites,
} from './sites';

type Load =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; sites: LocalSite[] }
  | { phase: 'failed'; error: BridgeFailure };

function toastFor(domain: string, change: SiteChange, label?: string): string {
  switch (change.kind) {
    case 'pause':
      return change.paused
        ? `Paused on ${domain}. It looks the way the site made it.`
        : `WebAble is on again on ${domain}.`;
    case 'block':
      return change.blocked
        ? `${label ?? 'That change'} is off on ${domain}.`
        : `${label ?? 'That change'} is back on for ${domain}.`;
    case 'forget':
      return `WebAble forgot its settings for ${domain}.`;
  }
}

function visitDay(ms: number): string {
  const day = formatRelativeDay(ms);
  return day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day;
}

function inverse(change: SiteChange): SiteChange | null {
  switch (change.kind) {
    case 'pause':
      return { kind: 'pause', paused: !change.paused };
    case 'block':
      return { kind: 'block', op: change.op, blocked: !change.blocked };
    case 'forget':
      return null;
  }
}

/**
 * Sites from this browser's extension (wa:sites), with Pause and Resume, turning
 * a change back on, and Forget. Updates show at once and are put back if the
 * extension refuses them. The list is never sent to WebAble's server.
 */
export function SitesPanel({ email }: { email: string | null }) {
  const { state, recheck } = useExtension();
  const [load, setLoad] = useState<Load>({ phase: 'idle' });
  const [query, setQuery] = useState('');
  const [pendingDomain, setPendingDomain] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState<string | null>(null);
  const [forgetBusy, setForgetBusy] = useState(false);
  const toast = useToast();

  const read = useCallback(async () => {
    setLoad((current) =>
      current.phase === 'ready' ? current : { phase: 'loading' },
    );
    const result = await extension.sites();
    if (result.ok) {
      setLoad({ phase: 'ready', sites: result.data });
    } else setLoad({ phase: 'failed', error: result.error });
  }, []);

  const installed = state.phase === 'ready';
  useEffect(() => {
    if (installed) void read();
  }, [installed, read]);

  async function update(
    domain: string,
    change: SiteChange,
    label?: string,
    undoable = true,
  ): Promise<boolean> {
    if (load.phase !== 'ready') return false;
    const before = load.sites;
    setPendingDomain(domain);
    setLoad({ phase: 'ready', sites: applyLocally(before, domain, change) });
    const result = await extension.updateSite(domain, change);
    setPendingDomain(null);
    if (!result.ok) {
      setLoad({ phase: 'ready', sites: before });
      toast.show({ message: `Nothing changed. ${result.error.message}` });
      return false;
    }
    setLoad({ phase: 'ready', sites: result.data });
    const undo = undoable ? inverse(change) : null;
    toast.show({
      message: toastFor(domain, change, label),
      applied: change.kind !== 'forget',
      ...(undo
        ? {
            action: {
              label: 'Undo',
              onAction: () => void update(domain, undo, label, false),
            },
          }
        : {}),
    });
    return true;
  }

  async function confirmForget() {
    if (!forgetting) return;
    setForgetBusy(true);
    const ok = await update(forgetting, { kind: 'forget' });
    setForgetBusy(false);
    if (ok) setForgetting(null);
  }

  // Site settings live in this browser whether or not it is connected; say so
  // when it isn't, because the fit it applies here may not be this account's.
  const view = connectView(state, email);
  const notConnectedNote =
    view.view === 'connect' ? (
      <div className="wa-app-note" role="note">
        <Icon name="info" size={20} />
        <div className="wa-app-note__body">
          <p className="wa-app-note__title">
            {view.otherEmail
              ? 'WebAble here is connected to a different account.'
              : 'WebAble here isn’t connected to your account.'}
          </p>
          <p>
            These sites are still this browser’s. Connect it to use your fit
            here. <TextLink href="/connect">Connect this browser</TextLink>
          </p>
        </div>
      </div>
    ) : null;

  /* ----- States before the list ----- */

  if (
    state.phase === 'checking' ||
    (installed && (load.phase === 'idle' || load.phase === 'loading'))
  ) {
    return (
      <p className="wa-browser-status" role="status">
        <span className="wa-browser-status__text">
          <StatusGlyph state="checking" />
          {installed
            ? 'Reading sites from this browser…'
            : 'Checking this browser…'}
        </span>
      </p>
    );
  }

  if (state.phase === 'missing') {
    return (
      <EmptyState
        title="WebAble isn’t in this browser"
        action={
          <Button href="/connect" variant="primary" arrow="forward">
            Add WebAble
          </Button>
        }
      >
        Your sites live in the extension, in this browser only. Add it to see
        them here.
      </EmptyState>
    );
  }

  if (state.phase === 'error') {
    return (
      <ErrorPanel
        title="Couldn’t reach WebAble"
        live
        action={
          <Button
            variant="secondary"
            iconStart="refresh-cw"
            onClick={() => void recheck()}
          >
            Check again
          </Button>
        }
      >
        <p>{state.error.message}</p>
      </ErrorPanel>
    );
  }

  if (load.phase === 'failed') {
    if (load.error.code === 'not_connected') {
      return (
        <EmptyState
          title="Connect this browser first"
          action={
            <Button href="/connect" variant="primary" arrow="forward">
              Connect this browser
            </Button>
          }
        >
          Once it’s connected to your account, its sites show up here.
        </EmptyState>
      );
    }
    return (
      <ErrorPanel
        title="Couldn’t read your sites"
        live
        action={
          <Button
            variant="secondary"
            iconStart="refresh-cw"
            onClick={() => void read()}
          >
            Try again
          </Button>
        }
      >
        <p>{load.error.message}</p>
      </ErrorPanel>
    );
  }

  if (load.phase !== 'ready') return null;

  const sites = sortSites(load.sites);
  if (sites.length === 0) {
    return (
      <>
        {notConnectedNote}
        <EmptyState title="No sites yet">
          Sites where you pause WebAble or turn a change off show up here.
        </EmptyState>
      </>
    );
  }

  const shown = filterSites(sites, query);

  return (
    <>
      {notConnectedNote}
      {sites.length > FILTER_AFTER ? (
        <TextField
          label="Find a site"
          type="search"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          hint={`${plural(shown.length, 'site')} shown`}
        />
      ) : null}

      <ul role="list" className="wa-rows" aria-label="Sites in this browser">
        {shown.map((site) => {
          const blocked = opLabels(site.blocked);
          const pinned = opLabels(site.pinned);
          const busy = pendingDomain === site.domain;
          const pill = site.paused
            ? { state: 'paused' as const, label: 'Paused' }
            : site.lastChanges > 0
              ? {
                  state: 'adapted' as const,
                  label: (
                    <>
                      Adapted · {site.lastChanges}
                      <span className="sr-only">
                        {site.lastChanges === 1 ? ' change' : ' changes'} on the
                        last visit
                      </span>
                    </>
                  ),
                }
              : { state: 'on' as const, label: 'On' };
          return (
            <li
              key={site.domain}
              className="wa-site-row"
              aria-busy={busy || undefined}
            >
              <div>
                <div className="wa-site-row__head">
                  <h3 className="wa-site-row__domain">{site.domain}</h3>
                  <StatusPill state={pill.state} label={pill.label} />
                </div>
                <p className="wa-row__detail">
                  {/* The pill already says how many changes are in effect. */}
                  Last visit {visitDay(site.lastVisit)}
                  {pinned.length > 0
                    ? ` · always on here: ${pinned.map((p) => p.label.toLowerCase()).join(', ')}`
                    : ''}
                </p>
              </div>
              <div className="wa-row__actions">
                <Button
                  variant="secondary"
                  size="md"
                  iconStart={site.paused ? 'play' : 'pause'}
                  disabled={busy}
                  onClick={() =>
                    void update(site.domain, {
                      kind: 'pause',
                      paused: !site.paused,
                    })
                  }
                >
                  {site.paused ? 'Resume' : 'Pause'}
                  <span className="sr-only"> on {site.domain}</span>
                </Button>
                <Button
                  variant="ghost"
                  size="md"
                  disabled={busy}
                  onClick={() => setForgetting(site.domain)}
                >
                  Forget
                  <span className="sr-only"> {site.domain}</span>
                </Button>
              </div>
              {blocked.length > 0 ? (
                <ul
                  role="list"
                  className="wa-site-row__ops"
                  aria-label={`Changes turned off on ${site.domain}`}
                >
                  {blocked.map(({ op, label }) => (
                    <li key={op} className="wa-site-row__op">
                      <span>{label} is off here</span>
                      <Button
                        variant="ghost"
                        size="md"
                        disabled={busy}
                        onClick={() =>
                          void update(
                            site.domain,
                            { kind: 'block', op, blocked: false },
                            label,
                          )
                        }
                      >
                        Turn back on
                        <span className="sr-only">
                          {' '}
                          {label.toLowerCase()} on {site.domain}
                        </span>
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
      {shown.length === 0 ? (
        <p className="wa-app-meta" role="status">
          No sites match “{query.trim()}”.
        </p>
      ) : null}

      <Dialog
        open={forgetting !== null}
        onOpenChange={(open) => {
          if (!open && !forgetBusy) setForgetting(null);
        }}
        title={`Forget ${forgetting ?? 'this site'}?`}
        description="WebAble removes what it keeps for this site in this browser: pauses, changes you turned off, and changes you kept on. This can’t be undone."
        actions={
          <Actions>
            <Button
              variant="danger-filled"
              busy={forgetBusy}
              busyLabel="Forgetting…"
              onClick={() => void confirmForget()}
            >
              Forget this site
            </Button>
            <Button
              variant="secondary"
              disabled={forgetBusy}
              onClick={() => setForgetting(null)}
            >
              Keep it
            </Button>
          </Actions>
        }
      />
    </>
  );
}
