'use client';

import {
  Actions,
  Button,
  Dialog,
  EmptyState,
  ErrorPanel,
  StatusGlyph,
  TextField,
  useToast,
} from '@webable/ui';
import { useCallback, useEffect, useRef, useState } from 'react';

import { type BridgeFailure, extension } from '../../../lib/extension/bridge';
import { useExtension } from '../../../lib/extension/useExtension';
import { formatRelativeDay, plural } from '../format';
import {
  appliesAgain,
  applyLocally,
  FILTER_AFTER,
  filterSites,
  hasRules,
  inverse,
  type SiteChange,
  type SitePreference,
  type SiteView,
  sitePreferences,
  sortSites,
} from './sites';

type Load =
  | { phase: 'idle' }
  | { phase: 'loading' }
  | { phase: 'ready'; sites: SiteView[] }
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
    case 'pin':
      return change.on
        ? `${label ?? 'That change'} is always on for ${domain}.`
        : `${label ?? 'That change'} follows your fit on ${domain} again.`;
    case 'reset':
      return `${domain} follows your fit again.`;
    case 'forget':
      return `WebAble forgot its settings for ${domain}.`;
  }
}

function visitDay(ms: number): string {
  const day = formatRelativeDay(ms);
  return day === 'Today' || day === 'Yesterday' ? day.toLowerCase() : day;
}

/** The op name in a preference row ("Click targets"), for toasts. */
function prefLabel(pref: SitePreference): string {
  const colon = pref.label.indexOf(': ');
  return colon >= 0 ? pref.label.slice(colon + 2) : pref.label;
}

/**
 * Sites from this browser's extension (wa:sites): only sites that keep
 * something of their own. Each thing a site keeps is a row with the action
 * that undoes it, and [Reset site] clears them all. Updates show at once and
 * are put back if the extension refuses them. The list never leaves this
 * browser.
 */
export function SitesPanel() {
  const { state, recheck } = useExtension();
  const [load, setLoad] = useState<Load>({ phase: 'idle' });
  const [query, setQuery] = useState('');
  const [pendingDomain, setPendingDomain] = useState<string | null>(null);
  const [resetting, setResetting] = useState<string | null>(null);
  const [resetBusy, setResetBusy] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const toast = useToast();

  const read = useCallback(async () => {
    setLoad((current) =>
      current.phase === 'ready' ? current : { phase: 'loading' },
    );
    const result = await extension.sites();
    if (result.ok) {
      setLoad({
        phase: 'ready',
        sites: (result.data as SiteView[]).filter(hasRules),
      });
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
  ): Promise<string | null> {
    if (load.phase !== 'ready') return 'Not ready';
    const before = load.sites;
    setPendingDomain(domain);
    setLoad({ phase: 'ready', sites: applyLocally(before, domain, change) });
    const result = await extension.updateSite(domain, change);
    setPendingDomain(null);
    if (!result.ok) {
      setLoad({ phase: 'ready', sites: before });
      toast.show({ message: `Nothing changed. ${result.error.message}` });
      return result.error.message;
    }
    const sites = (result.data as SiteView[]).filter(hasRules);
    setLoad({ phase: 'ready', sites });
    // A site with nothing left of its own leaves the list: keep focus on it.
    if (!sites.some((s) => s.domain === domain))
      requestAnimationFrame(() => listRef.current?.focus());
    const undo = undoable ? inverse(change) : null;
    toast.show({
      message: toastFor(domain, change, label),
      applied: appliesAgain(change),
      ...(undo
        ? {
            action: {
              label: 'Undo',
              onAction: () => void update(domain, undo, label, false),
            },
          }
        : {}),
    });
    return null;
  }

  async function confirmReset() {
    if (!resetting) return;
    setResetBusy(true);
    setResetError(null);
    const error = await update(resetting, { kind: 'reset' });
    setResetBusy(false);
    if (error) setResetError(error);
    else setResetting(null);
  }

  /* ----- States before the list (the page head says the rest) ----- */

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
      <EmptyState title="No sites here yet" as="h3">
        Sites live in the extension, in this browser only. They show up here
        once WebAble is in this browser.
      </EmptyState>
    );
  }

  if (state.phase === 'error') {
    return (
      <ErrorPanel
        title="Couldn’t reach WebAble"
        as="h3"
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
        <EmptyState title="No sites here yet" as="h3">
          Once this browser is connected to your account, its sites show up
          here.
        </EmptyState>
      );
    }
    return (
      <ErrorPanel
        title="Couldn’t read your sites"
        as="h3"
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
      <EmptyState title="No sites yet" as="h3">
        Sites where you pause WebAble or change a setting show up here.
      </EmptyState>
    );
  }

  const shown = filterSites(sites, query);

  return (
    <>
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

      <ul
        ref={listRef}
        tabIndex={-1}
        role="list"
        className="wa-rows wa-sites"
        aria-label="Sites in this browser"
      >
        {shown.map((site) => {
          const busy = pendingDomain === site.domain;
          const prefs = sitePreferences(site);
          return (
            <li
              key={site.domain}
              className="wa-site-row"
              aria-busy={busy || undefined}
            >
              <div className="wa-row wa-row--split wa-row--end-action wa-site-row__head">
                <div>
                  <h3 className="wa-site-row__domain">{site.domain}</h3>
                  {site.lastVisit > 0 ? (
                    <p className="wa-row__detail">
                      Last visit {visitDay(site.lastVisit)}
                    </p>
                  ) : null}
                </div>
                <div className="wa-row__actions">
                  <Button
                    variant="ghost"
                    size="md"
                    flush="end"
                    disabled={busy}
                    onClick={() => {
                      setResetError(null);
                      setResetting(site.domain);
                    }}
                  >
                    Reset site
                    <span className="sr-only"> {site.domain}</span>
                  </Button>
                </div>
              </div>
              <ul
                role="list"
                className="wa-site-row__prefs"
                aria-label={`What ${site.domain} keeps`}
              >
                {prefs.map((pref) => (
                  <li
                    key={pref.key}
                    className="wa-row wa-row--split wa-row--end-action wa-site-pref"
                  >
                    <p className="wa-site-pref__label">{pref.label}</p>
                    <div className="wa-row__actions">
                      {pref.change ? (
                        <Button
                          variant="ghost"
                          size="md"
                          flush="end"
                          disabled={busy}
                          onClick={() => {
                            const change = pref.change;
                            if (change)
                              void update(site.domain, change, prefLabel(pref));
                          }}
                        >
                          {pref.action}
                          <span className="sr-only"> {pref.actionContext}</span>
                        </Button>
                      ) : (
                        <span className="wa-site-pref__hint">
                          Clears with Reset site
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
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
        open={resetting !== null}
        onOpenChange={(open) => {
          if (!open && !resetBusy) setResetting(null);
        }}
        title={`Reset ${resetting ?? 'this site'}?`}
        description="WebAble drops what this site keeps in this browser: a pause, changes you turned off or kept on, and sizes set for it. The site follows your fit again. This can’t be undone."
        actions={
          <Actions>
            <Button
              variant="danger-filled"
              busy={resetBusy}
              busyLabel="Resetting…"
              onClick={() => void confirmReset()}
            >
              Reset site
            </Button>
            <Button
              variant="secondary"
              disabled={resetBusy}
              onClick={() => setResetting(null)}
            >
              Keep it
            </Button>
          </Actions>
        }
      >
        {resetError ? (
          <p className="wa-reason" role="alert">
            Nothing changed. {resetError}
          </p>
        ) : null}
      </Dialog>
    </>
  );
}
