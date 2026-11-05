// Owner: C1. The in-page entry: boots the engine, then mounts the in-page UI (pill, panel, Lens, Calm view).
// Round 8c: first asks the worker whether this tab is the onboarding's real-website task tab; there, WebAble changes
// nothing and only shows the task card (src/sitetask/task.ts).
import { createController } from '../src/engine/controller';
import { askWhoami, runTaskMode } from '../src/sitetask/task';
import { mountUi } from '../src/ui/mount';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  allFrames: false,
  async main(ctx) {
    // Never on our own extension pages (fitting, popup) and only in the top frame.
    if (location.protocol === 'chrome-extension:' || location.href.startsWith(chrome.runtime.getURL(''))) return;
    if (window.top !== window) return;
    if (!document.documentElement || document.contentType && !/html|xml/i.test(document.contentType)) return;

    // The onboarding's task tab: no engine, no in-page UI, just the task card (or nothing, off the task's site).
    const who = await askWhoami();
    if (who) {
      if (who.task) {
        const stop = runTaskMode({ task: who.task, index: who.index, total: who.total });
        ctx.onInvalidated(stop);
      }
      return;
    }
    if (ctx.isInvalid) return;

    const engine = createController();
    // For the eval harness and debugging: visible to extension code in this isolated world only, never to the page.
    (globalThis as { __webableEngine?: typeof engine.api }).__webableEngine = engine.api;
    let unmount: (() => void) | null = null;
    try {
      unmount = mountUi(engine.api);
    } catch (err) {
      console.warn('[WebAble] the in-page UI could not mount', err);
    }
    void engine.start().catch((err: unknown) => console.warn('[WebAble] engine failed to start', err));

    ctx.onInvalidated(() => {
      engine.stop();
      try {
        unmount?.();
      } catch {
        /* already gone */
      }
    });
  },
});
