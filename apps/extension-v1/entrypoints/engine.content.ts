import { vocabFilter } from '@webable/core/page/vocab';
import { defineContentScript } from 'wxt/utils/define-content-script';

import { ContentAdapter, startOnce } from '@/lib/engine/adapter';
import { chromeTransport, closedShadowRootOpener } from '@/lib/engine/chrome';
import { installFirewall } from '@/lib/engine/fitview/firewall';

/**
 * The in-page engine content script. Registered at runtime by the service
 * worker (chrome.scripting.registerContentScripts, runAt document_start,
 * allFrames) only after the person grants site access, so it adds no host
 * permission to the manifest. Output: content-scripts/engine.js.
 *
 * Flow: cs:hello at document_start -> DOMContentLoaded -> extract ->
 * cs:signals -> apply the plan in one write -> verify -> cs:applied, then
 * keep changes applied as the page changes. Pausing or invalidation
 * (extension reload) restores the page exactly. One engine per document: a
 * second injection reports the running one (cs:hello {restored}) instead.
 *
 * Fit view's input firewall is installed first, before any page script can
 * register a listener (docs/10 §4.5). It stays for the document's lifetime
 * and does nothing until Fit view opens.
 */
export default defineContentScript({
  registration: 'runtime',
  runAt: 'document_start',
  noScriptStartedPostMessage: true,
  main(ctx) {
    if (!(document instanceof HTMLDocument)) return;
    installFirewall(window);
    const { adapter, created } = startOnce(
      window,
      () =>
        new ContentAdapter({
          transport: chromeTransport(),
          vocab: { vocabFilter },
          openClosed: closedShadowRootOpener(),
          alive: () => ctx.isValid,
        }),
    );
    if (created) ctx.onInvalidated(() => adapter.stop());
  },
});
