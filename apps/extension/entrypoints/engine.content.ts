import { vocabFilter } from '@webable/core/page/vocab';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { ContentAdapter } from '@/lib/engine/adapter';
import {
  chromeAnnounceStore,
  chromeTransport,
  closedShadowRootOpener,
} from '@/lib/engine/chrome';

/**
 * The in-page engine content script. Registered at runtime by the service
 * worker (chrome.scripting.registerContentScripts, runAt document_start,
 * allFrames) only after the person grants site access, so it adds no host
 * permission to the manifest. Output: content-scripts/engine.js.
 *
 * Flow: cs:hello at document_start -> DOMContentLoaded -> extract ->
 * cs:signals -> apply the plan in one write -> verify -> cs:applied, then
 * keep changes applied as the page changes. Pausing or invalidation
 * (extension reload) restores the page exactly.
 */
export default defineContentScript({
  registration: 'runtime',
  runAt: 'document_start',
  noScriptStartedPostMessage: true,
  main(ctx) {
    if (!(document instanceof HTMLDocument) || !document.documentElement)
      return;
    const adapter = new ContentAdapter({
      transport: chromeTransport(),
      vocab: { vocabFilter },
      announce: chromeAnnounceStore(location.hostname),
      openClosed: closedShadowRootOpener(),
    });
    ctx.onInvalidated(() => adapter.stop());
    void adapter.start().catch(() => adapter.stop());
  },
});
