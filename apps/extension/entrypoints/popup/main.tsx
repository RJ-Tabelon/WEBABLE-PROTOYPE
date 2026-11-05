// Owner: P, F. The toolbar popup: WebAble on or off, this site's "Pause on this site", Your settings, and (round 9) how
// you like things explained. Nothing else: everything about a page lives in the WebAble button on that page.
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import type { Settings } from '@webable/core';
import { Logo } from '../../src/ui/Logo';
import { activeTab, mergeSettings, readSettings, siteLabel, writeSettings, type ActiveTab } from './data';
import './popup.css';

function Switch(props: { checked: boolean; label: string; tone: 'accent' | 'ink'; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      class="sw"
      role="switch"
      aria-checked={props.checked}
      aria-label={props.label}
      data-tone={props.tone}
      disabled={props.disabled}
      onClick={() => props.onChange(!props.checked)}
    >
      <span class="sw-track" aria-hidden="true" />
    </button>
  );
}

function Popup() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [tab, setTab] = useState<ActiveTab | null>(null);

  useEffect(() => {
    void readSettings().then(setSettings);
    void activeTab().then(setTab);
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && changes.settings) setSettings(mergeSettings(changes.settings.newValue));
    };
    try {
      chrome.storage.onChanged.addListener(onChange);
    } catch {
      /* no storage events: the popup still works from what it read */
    }
    return () => {
      try {
        chrome.storage.onChanged.removeListener(onChange);
      } catch {
        /* ignore */
      }
    };
  }, []);

  const update = (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    void writeSettings(next, patch).catch(() => {});
  };

  const on = settings?.enabled ?? true;
  const origin = tab?.origin ?? null;
  const site = siteLabel(origin);
  const paused = Boolean(origin && settings?.pausedOrigins.includes(origin));

  const togglePause = (v: boolean) => {
    if (!settings || !origin) return;
    const rest = settings.pausedOrigins.filter((o) => o !== origin);
    update({ pausedOrigins: v ? [...rest, origin] : rest });
  };

  const openFitting = async (hash: '#settings' | '#ai') => {
    try {
      await chrome.tabs.create({ url: chrome.runtime.getURL(`/fitting.html${hash}`) });
    } finally {
      window.close();
    }
  };

  return (
    <main class="p">
      <header class="p-head">
        <span class="mark" data-on={on ? 'true' : 'false'} aria-hidden="true">
          <Logo />
        </span>
        <h1>WebAble</h1>
        <Switch checked={on} tone="accent" label="WebAble" disabled={!settings} onChange={(v) => update({ enabled: v })} />
      </header>

      <section class="card" aria-label="This site">
        {origin ? (
          <>
            <p class="site">{site}</p>
            <div class="row" data-dim={on ? undefined : 'true'}>
              <span class="row-label" id="pause-label">
                Pause on this site
              </span>
              <Switch checked={paused} tone="ink" label="Pause on this site" disabled={!settings || !on} onChange={togglePause} />
            </div>
          </>
        ) : (
          <p class="site-none">WebAble works on websites. Open one to see it.</p>
        )}
      </section>

      <button class="btn" onClick={() => void openFitting('#settings')}>
        Your settings
      </button>
      <button class="btn" onClick={() => void openFitting('#ai')} data-open="ai">
        How you like things explained
      </button>

      <p class="foot">WebAble adjusts each page to you automatically.</p>
    </main>
  );
}

const root = document.getElementById('app');
if (root) render(<Popup />, root);
