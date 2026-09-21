import { useEffect, useRef, useState } from 'react';
import type { PageRulePreferences, PageSnapshot } from '@webable/shared';

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

  return (
    <main>
      <header>
        <div className="brand-mark" aria-hidden="true">
          W
        </div>
        <div>
          <p className="eyebrow">WebAble</p>
          <h1>Page reader</h1>
        </div>
      </header>

      <p className="privacy-note">Read locally. Nothing leaves your browser.</p>

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
        <section aria-labelledby="page-title">
          <div className="page-heading">
            <p className="eyebrow">Current page</p>
            <h2 id="page-title">{snapshot.title || 'Untitled page'}</h2>
            <p className="origin">{new URL(snapshot.url).hostname}</p>
          </div>

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

          <div className="excerpt">
            <h3>Text preview</h3>
            <p>{snapshot.text.excerpt || 'No readable text was found.'}</p>
          </div>

          {preferences && (
            <fieldset disabled={isApplying}>
              <legend>Page adjustments</legend>
              <label className="toggle-row">
                <span>
                  <strong>Minimum 16px text</strong>
                  <small>
                    {snapshot.text.belowMinimumSize} small elements found
                  </small>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.minimumTextSize}
                  onChange={(event) =>
                    void updatePreferences({
                      ...preferences,
                      minimumTextSize: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Readable text spacing</strong>
                  <small>Line, letter, word, and paragraph spacing</small>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.textSpacing}
                  onChange={(event) =>
                    void updatePreferences({
                      ...preferences,
                      textSpacing: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Enhanced keyboard focus</strong>
                  <small>High-visibility focus outlines</small>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.enhancedFocus}
                  onChange={(event) =>
                    void updatePreferences({
                      ...preferences,
                      enhancedFocus: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="toggle-row">
                <span>
                  <strong>Reduce page motion</strong>
                  <small>Stops animations, transitions, and autoplay</small>
                </span>
                <input
                  type="checkbox"
                  checked={preferences.reduceMotion}
                  onChange={(event) =>
                    void updatePreferences({
                      ...preferences,
                      reduceMotion: event.target.checked,
                    })
                  }
                />
              </label>
              <label className="select-row">
                <span>Contrast</span>
                <select
                  value={preferences.contrastMode}
                  onChange={(event) =>
                    void updatePreferences({
                      ...preferences,
                      contrastMode: event.target
                        .value as PageRulePreferences['contrastMode'],
                    })
                  }
                >
                  <option value="unchanged">Original page</option>
                  <option value="high">High contrast</option>
                  <option value="dark">Dark page</option>
                </select>
              </label>
              <p className="live-status" aria-live="polite">
                {isApplying
                  ? 'Applying adjustments…'
                  : `Watching page changes · revision ${snapshot.domRevision}`}
              </p>
            </fieldset>
          )}
        </section>
      )}

      {!isReading && (
        <button type="button" onClick={() => void inspectPageNow()}>
          Read page again
        </button>
      )}
    </main>
  );
}
