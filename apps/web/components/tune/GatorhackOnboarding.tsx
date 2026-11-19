'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { getPublicEnv } from '../../lib/env';
import { extension } from '../../lib/extension/bridge';
import { useExtension } from '../../lib/extension/useExtension';
import './gatorhack.css';

/** Run the original page, including Chrome settings, real-site tasks and the engine's saved fit. */
export function GatorhackOnboarding() {
  const { state, recheck } = useExtension();
  const frame = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [hash, setHash] = useState('');
  const id = getPublicEnv().extensionId;
  const ready = state.phase === 'ready' && id !== null;

  useEffect(() => {
    const update = () => {
      setHash(
        ['#settings', '#ai'].includes(location.hash) ? location.hash : '',
      );
    };
    update();
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    if (!ready || !id) return;
    let mounted = false;
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.origin !== `chrome-extension://${id}` ||
        event.data?.type !== 'webable:fitting-ready'
      )
        return;
      mounted = true;
      setLoaded(true);
      setProblem(null);
    };
    window.addEventListener('message', receive);
    const timer = window.setTimeout(() => {
      if (!mounted)
        setProblem(
          'Reload WebAble in Chrome’s extensions page, then reload this page.',
        );
    }, 10_000);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('message', receive);
    };
  }, [ready, id]);

  const openInTab = async () => {
    const result = await extension.openWelcome();
    if (!result.ok) setProblem(result.error.message);
  };

  return (
    <main id="main" className="gatorhack-onboarding">
      {ready ? (
        <>
          <iframe
            ref={frame}
            src={`chrome-extension://${id}/fitting.html${hash}`}
            title="Set up WebAble"
            className="gatorhack-onboarding__frame"
          />
          {!loaded && (
            <div className="gatorhack-onboarding__loading" role="status">
              Opening WebAble…
            </div>
          )}
        </>
      ) : (
        <section className="gatorhack-onboarding__notice">
          <Link href="/">WebAble</Link>
          <h1>Let’s set up the web for you.</h1>
          <p>
            Three short parts: reading, pointing and finding. About two minutes.
            There are no wrong answers.
          </p>
          {state.phase === 'checking' ? (
            <p role="status">Checking for WebAble…</p>
          ) : (
            <>
              <p>
                Add the WebAble extension to Chrome to get started. The finding
                tasks open real websites, and your settings are saved directly
                to WebAble.
              </p>
              <div className="gatorhack-onboarding__actions">
                <Link href="/get">Get WebAble</Link>
                <button type="button" onClick={() => void recheck()}>
                  Check again
                </button>
              </div>
              {state.phase === 'error' && (
                <p role="alert">{state.error.message}</p>
              )}
            </>
          )}
        </section>
      )}
      {problem && (
        <aside className="gatorhack-onboarding__problem" role="alert">
          <p>{problem}</p>
          <button type="button" onClick={() => void openInTab()}>
            Open setup in its own tab
          </button>
        </aside>
      )}
    </main>
  );
}
