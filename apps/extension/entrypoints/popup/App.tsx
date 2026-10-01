import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  defaultPageRulePreferences,
  type PageRulePreferences,
  type PageSnapshot,
} from '@webable/shared';

export type PageSession = {
  tabId: number;
  snapshot: PageSnapshot;
  preferences: PageRulePreferences;
};

type AppProps = {
  inspectPage: () => Promise<PageSession>;
  readPage: (tabId: number) => Promise<PageSnapshot>;
  applyRules: (
    tabId: number,
    preferences: PageRulePreferences,
  ) => Promise<PageSnapshot>;
  subscribeToPageUpdates: (
    callback: (tabId: number, revision: number) => void,
  ) => () => void;
};

type ToggleKey = Exclude<keyof PageRulePreferences, 'contrastMode'>;

// Lucide icon paths (ISC license), inlined so the popup makes no network requests.
const ICONS = {
  lock: (
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>
  ),
  type: (
    <>
      <polyline points="4 7 4 4 20 4 20 7" />
      <line x1="9" x2="15" y1="20" y2="20" />
      <line x1="12" x2="12" y1="4" y2="20" />
    </>
  ),
  spacing: (
    <>
      <path d="M13 4v16" />
      <path d="M17 4v16" />
      <path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13" />
    </>
  ),
  focus: (
    <>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect width="8" height="8" x="8" y="8" rx="1" />
    </>
  ),
  pause: (
    <>
      <circle cx="12" cy="12" r="10" />
      <line x1="10" x2="10" y1="15" y2="9" />
      <line x1="14" x2="14" y1="15" y2="9" />
    </>
  ),
  contrast: (
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 18a6 6 0 0 0 0-12v12z" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  undo: (
    <>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </>
  ),
  ok: (
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </>
  ),
  warn: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
} satisfies Record<string, ReactNode>;

function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg
      className="icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  );
}

const TOGGLES: {
  key: ToggleKey;
  icon: keyof typeof ICONS;
  label: string;
  hint: (snapshot: PageSnapshot) => string;
}[] = [
  {
    key: 'minimumTextSize',
    icon: 'type',
    label: 'Minimum 16px text',
    hint: (snapshot) =>
      `${snapshot.text.belowMinimumSize} small elements found`,
  },
  {
    key: 'textSpacing',
    icon: 'spacing',
    label: 'Readable text spacing',
    hint: () => 'Line, letter, word, and paragraph spacing',
  },
  {
    key: 'enhancedFocus',
    icon: 'focus',
    label: 'Enhanced keyboard focus',
    hint: () => 'High-visibility focus outlines',
  },
  {
    key: 'reduceMotion',
    icon: 'pause',
    label: 'Reduce page motion',
    hint: () => 'Stops animations, transitions, and autoplay',
  },
];

const CONTRAST_OPTIONS: {
  value: PageRulePreferences['contrastMode'];
  label: string;
}[] = [
  { value: 'unchanged', label: 'Original' },
  { value: 'high', label: 'High' },
  { value: 'dark', label: 'Dark' },
];

function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);

  if (
    message.includes('Cannot access') ||
    message.includes('The extensions gallery')
  ) {
    return 'Chrome protects this page. Open a regular website and try again.';
  }

  return 'WebAble could not read this page. Refresh the page and try again.';
}

function findings(snapshot: PageSnapshot) {
  const small = snapshot.text.belowMinimumSize;
  const missingAlt = snapshot.images.withoutAlt;

  return [
    {
      ok: small === 0,
      text:
        small === 0
          ? 'All text is 16px or larger'
          : `${small} text elements below 16px`,
      note: small === 0 ? null : 'Fixable with Minimum 16px text',
    },
    {
      ok: !snapshot.layout.hasHorizontalOverflow,
      text: snapshot.layout.hasHorizontalOverflow
        ? 'Page scrolls sideways'
        : 'No sideways scrolling',
      note: null,
    },
    {
      ok: missingAlt === 0,
      text:
        missingAlt === 0
          ? 'Images have alt text'
          : `${missingAlt} images missing alt text`,
      note: missingAlt === 0 ? null : 'Site issue. WebAble cannot fix this.',
    },
  ];
}

export function App({
  inspectPage,
  readPage,
  applyRules,
  subscribeToPageUpdates,
}: AppProps) {
  const [snapshot, setSnapshot] = useState<PageSnapshot | null>(null);
  const [preferences, setPreferences] = useState<PageRulePreferences | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [isReading, setIsReading] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const activeTabId = useRef<number | null>(null);

  const inspectPageNow = async () => {
    setIsReading(true);
    setError(null);

    try {
      const session = await inspectPage();
      activeTabId.current = session.tabId;
      setSnapshot(session.snapshot);
      setPreferences(session.preferences);
    } catch (nextError) {
      console.error('WebAble page inspection failed', nextError);
      setSnapshot(null);
      setError(friendlyError(nextError));
    } finally {
      setIsReading(false);
    }
  };

  useEffect(() => {
    void inspectPageNow();

    return subscribeToPageUpdates((tabId) => {
      if (tabId === activeTabId.current) {
        void readPage(tabId)
          .then(setSnapshot)
          .catch(() => undefined);
      }
    });
  }, [subscribeToPageUpdates]);

  const updatePreferences = async (next: PageRulePreferences) => {
    if (activeTabId.current == null) return;
    setPreferences(next);
    setIsApplying(true);
    setError(null);

    try {
      setSnapshot(await applyRules(activeTabId.current, next));
    } catch (nextError) {
      console.error('WebAble rule application failed', nextError);
      setError(friendlyError(nextError));
    } finally {
      setIsApplying(false);
    }
  };

  const activeCount = preferences
    ? TOGGLES.filter(({ key }) => preferences[key]).length +
      (preferences.contrastMode === 'unchanged' ? 0 : 1)
    : 0;

  return (
    <main>
      <header className="app-header">
        <div className="brand-mark" aria-hidden="true">
          W
        </div>
        <div className="brand-text">
          <h1>WebAble</h1>
          <p>Adapts the page to you</p>
        </div>
        {!isReading && (
          <button
            type="button"
            className="icon-button"
            aria-label="Read page again"
            title="Read page again"
            onClick={() => void inspectPageNow()}
          >
            <Icon name="refresh" />
          </button>
        )}
      </header>

      <p className="privacy-note">
        <Icon name="lock" />
        Read locally. Nothing leaves your browser.
      </p>

      {isReading && (
        <div className="status" role="status">
          <span className="spinner" aria-hidden="true" />
          Reading this page…
        </div>
      )}

      {error && (
        <div className="error" role="alert">
          <strong>Page unavailable</strong>
          <span>{error}</span>
        </div>
      )}

      {snapshot && !isReading && (
        <>
          {preferences && (
            <fieldset className="adjustments" disabled={isApplying}>
              <legend>
                Page adjustments
                <span className="count">
                  {activeCount === 0 ? 'All off' : `${activeCount} on`}
                </span>
              </legend>

              {TOGGLES.map(({ key, icon, label, hint }) => (
                <label className="toggle-row" key={key}>
                  <span className="toggle-icon">
                    <Icon name={icon} />
                  </span>
                  <span className="toggle-text">
                    <strong>{label}</strong>
                    <small>{hint(snapshot)}</small>
                  </span>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={preferences[key]}
                    onChange={(event) =>
                      void updatePreferences({
                        ...preferences,
                        [key]: event.target.checked,
                      })
                    }
                  />
                </label>
              ))}

              <fieldset className="contrast-row">
                <legend>
                  <span className="toggle-icon">
                    <Icon name="contrast" />
                  </span>
                  Contrast
                </legend>
                <div className="segmented">
                  {CONTRAST_OPTIONS.map(({ value, label }) => (
                    <label key={value}>
                      <input
                        type="radio"
                        name="contrast"
                        value={value}
                        checked={preferences.contrastMode === value}
                        onChange={() =>
                          void updatePreferences({
                            ...preferences,
                            contrastMode: value,
                          })
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="adjustments-footer">
                <p className="live-status" aria-live="polite">
                  <span className="pulse" aria-hidden="true" />
                  {isApplying ? 'Applying…' : 'Watching for page changes'}
                </p>
                <button
                  type="button"
                  className="reset-button"
                  disabled={activeCount === 0}
                  onClick={() =>
                    void updatePreferences({ ...defaultPageRulePreferences })
                  }
                >
                  <Icon name="undo" />
                  Reset all
                </button>
              </div>
            </fieldset>
          )}
          <section className="card" aria-labelledby="page-title">
            <p className="eyebrow">Current page</p>
            <h2 id="page-title">{snapshot.title || 'Untitled page'}</h2>
            <p className="origin">{new URL(snapshot.url).hostname}</p>

            <dl className="metrics">
              <div>
                <dt>Words</dt>
                <dd>{snapshot.text.wordCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Headings</dt>
                <dd>{snapshot.headingCount}</dd>
              </div>
              <div>
                <dt>Links</dt>
                <dd>{snapshot.links.total}</dd>
              </div>
              <div>
                <dt>Controls</dt>
                <dd>
                  {snapshot.controls.buttons +
                    snapshot.controls.inputs +
                    snapshot.controls.selects +
                    snapshot.controls.textareas}
                </dd>
              </div>
            </dl>

            <ul className="findings" aria-label="Page check">
              {findings(snapshot).map((finding) => (
                <li key={finding.text} data-ok={finding.ok}>
                  <Icon name={finding.ok ? 'ok' : 'warn'} />
                  <span>
                    {finding.text}
                    {finding.note && <small>{finding.note}</small>}
                  </span>
                </li>
              ))}
            </ul>

            <details className="excerpt" open>
              <summary>Text preview</summary>
              <p>{snapshot.text.excerpt || 'No readable text was found.'}</p>
            </details>
          </section>
        </>
      )}

      {error && (
        <button
          type="button"
          className="primary-button"
          onClick={() => void inspectPageNow()}
        >
          Try again
        </button>
      )}
    </main>
  );
}
