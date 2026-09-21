import React from 'react';
import ReactDOM from 'react-dom/client';
import {
  pageRulePreferencesSchema,
  pageSnapshotSchema,
  type PageRulePreferences,
  type PageSnapshot,
  type PageUpdatedMessage,
  type ReaderRequest,
} from '@webable/shared';

import { App, type PageSession } from './App';
import './style.css';

function parseSnapshot(value: unknown): PageSnapshot {
  const result = pageSnapshotSchema.safeParse(value);

  if (!result.success) {
    throw new Error(
      `Invalid page snapshot: ${JSON.stringify(result.error.issues)}`,
    );
  }

  return result.data;
}

async function inspectActivePage(): Promise<PageSession> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });

  if (tab?.id == null) {
    throw new Error('No active browser tab was found.');
  }

  const results = await browser.scripting.executeScript({
    target: { tabId: tab.id },
    files: ['/content-scripts/reader.js'],
  });
  const preferencesRequest: ReaderRequest = {
    type: 'webable:get-preferences',
  };
  const rawPreferences = await browser.tabs.sendMessage(
    tab.id,
    preferencesRequest,
  );

  return {
    tabId: tab.id,
    snapshot: parseSnapshot(results[0]?.result),
    preferences: pageRulePreferencesSchema.parse(rawPreferences),
  };
}

async function readPage(tabId: number): Promise<PageSnapshot> {
  const request: ReaderRequest = { type: 'webable:read' };
  const result = await browser.tabs.sendMessage(tabId, request);
  return parseSnapshot(result);
}

async function applyRules(
  tabId: number,
  preferences: PageRulePreferences,
): Promise<PageSnapshot> {
  const request: ReaderRequest = {
    type: 'webable:apply-rules',
    preferences: pageRulePreferencesSchema.parse(preferences),
  };
  const result = await browser.tabs.sendMessage(tabId, request);
  return parseSnapshot(result);
}

function subscribeToPageUpdates(
  callback: (tabId: number, revision: number) => void,
): () => void {
  const listener = (
    message: PageUpdatedMessage,
    sender: Browser.runtime.MessageSender,
  ) => {
    if (
      message?.type === 'webable:page-updated' &&
      typeof message.revision === 'number' &&
      sender.tab?.id != null
    ) {
      callback(sender.tab.id, message.revision);
    }
  };

  browser.runtime.onMessage.addListener(listener);
  return () => browser.runtime.onMessage.removeListener(listener);
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App
      inspectPage={inspectActivePage}
      readPage={readPage}
      applyRules={applyRules}
      subscribeToPageUpdates={subscribeToPageUpdates}
    />
  </React.StrictMode>,
);
