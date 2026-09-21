import {
  defaultPageRulePreferences,
  type PageRulePreferences,
  type PageUpdatedMessage,
  type ReaderRequest,
} from '@webable/shared';

import { readPage } from '@/lib/page-reader';
import { applyAccessibilityRules } from '@/lib/rule-engine';

type ReaderRuntimeState = {
  observer: MutationObserver;
  preferences: PageRulePreferences;
  revision: number;
  updateTimer?: ReturnType<typeof setTimeout>;
};

type ReaderGlobal = typeof globalThis & {
  __webableReaderState?: ReaderRuntimeState;
};

function snapshot(state: ReaderRuntimeState) {
  return readPage(document, window.location, state.revision);
}

export default defineContentScript({
  registration: 'runtime',
  main() {
    const readerGlobal = globalThis as ReaderGlobal;

    if (readerGlobal.__webableReaderState) {
      return snapshot(readerGlobal.__webableReaderState);
    }

    const state: ReaderRuntimeState = {
      observer: undefined as unknown as MutationObserver,
      preferences: { ...defaultPageRulePreferences },
      revision: 0,
    };

    applyAccessibilityRules(document, state.preferences);

    state.observer = new MutationObserver(() => {
      state.revision += 1;
      clearTimeout(state.updateTimer);
      state.updateTimer = setTimeout(() => {
        applyAccessibilityRules(document, state.preferences);
        const message: PageUpdatedMessage = {
          type: 'webable:page-updated',
          revision: state.revision,
        };
        void browser.runtime.sendMessage(message).catch(() => {
          // The popup is usually closed. Updates remain available on next read.
        });
      }, 120);
    });
    state.observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    browser.runtime.onMessage.addListener(async (request: ReaderRequest) => {
      if (request.type === 'webable:read') {
        return snapshot(state);
      }

      if (request.type === 'webable:get-preferences') {
        return state.preferences;
      }

      if (request.type === 'webable:apply-rules') {
        state.preferences = request.preferences;
        applyAccessibilityRules(document, state.preferences);
        return snapshot(state);
      }

      return undefined;
    });

    readerGlobal.__webableReaderState = state;
    return snapshot(state);
  },
});
