import { browser } from 'wxt/browser';
import type { BridgeStatus } from '@webable/core/bridge/protocol';

import type { ContentToWorker } from '../protocol';
import { normalizeSystem } from '../storage/account';
import { chromeArea, restrictToTrustedContexts } from '../storage/area';
import { clearLocalData, createStores } from '../storage';
import { listLocalSites, resetRule } from '../storage/sites';
import { createAuthService } from './auth';
import { handleBridge, type BridgeHandlers } from './bridge';
import { siteKey } from './cachekeys';
import { chromePort } from './chrome';
import { readConfig } from './config';
import { PageMemos } from './pages';
import { hasAllSites, injectTab, reconcileRegistration } from './permissions';
import {
  parseContent,
  parseUi,
  senderKind,
  type RuntimeSender,
} from './router';
import { AccountSync, platformBucket } from './sync';
import { TabRegistry } from './tabs';
import type { UiMessage } from './ui';
import { UndoHold } from './undo';
import { Worker, type Registration } from './worker';

/**
 * The service worker. Every listener is registered synchronously at the top
 * level (MV3: the worker is started for an event and must have its listener in
 * place). No state survives in globals that matters: everything is rehydrated
 * from storage.
 */

/** The engine's interim local memory of announced sites (superseded by the worker's site records). */
export const LEGACY_ANNOUNCED_KEY = 'engine.announcedSites';

export const ALARMS = {
  auth: { name: 'wa-auth', periodInMinutes: 30 },
  sync: { name: 'wa-sync', periodInMinutes: 60 },
} as const;

type SendResponse = (reply: unknown) => void;

export function startServiceWorker(): void {
  const config = readConfig();
  const local = chromeArea('local');
  const session = chromeArea('session');
  const stores = createStores(local);
  const tabs = new TabRegistry(session);
  const pages = new PageMemos(session);
  const undos = new UndoHold(session);
  const port = chromePort();
  const version = browser.runtime.getManifest().version;
  const auth =
    config.supabaseUrl && config.publishableKey
      ? createAuthService({
          url: config.supabaseUrl,
          publishableKey: config.publishableKey,
          area: local,
        })
      : null;
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const sync = auth
    ? new AccountSync({
        stores,
        auth,
        now: Date.now,
        version,
        platform: platformBucket(nav.userAgentData?.platform ?? nav.platform),
      })
    : null;
  const registration: Registration = {
    hasAllSites,
    async reconcile(prePaint, pausedDomains) {
      await reconcileRegistration({ prePaint, pausedDomains });
    },
    inject: injectTab,
    async openTabs() {
      const all = await browser.tabs.query({});
      return all
        .filter((t): t is typeof t & { id: number } => typeof t.id === 'number')
        .map((t) => ({ id: t.id, url: t.url }));
    },
  };
  const worker = new Worker({
    config,
    stores,
    tabs,
    pages,
    undos,
    port,
    registration,
    auth,
    sync,
    now: Date.now,
  });

  auth?.onLost(() => {
    void sync?.signedOut(true).then(() => worker.refreshAllBadges());
  });

  // ---------------------------------------------------------------- lifecycle
  const boot = async (): Promise<void> => {
    await restrictToTrustedContexts().catch(() => undefined);
    await stores.install.get();
    // The engine's interim first-visit memory; the worker decides `announce` now.
    await local.remove([LEGACY_ANNOUNCED_KEY]).catch(() => undefined);
    await worker.flushUndos().catch(() => undefined);
    for (const alarm of Object.values(ALARMS)) {
      const existing = await browser.alarms.get(alarm.name);
      if (!existing)
        await browser.alarms.create(alarm.name, {
          periodInMinutes: alarm.periodInMinutes,
          delayInMinutes: 1,
        });
    }
    await worker.reconcileRegistration(true);
    if (await hasAllSites()) await worker.grantedAllSites();
  };

  browser.runtime.onInstalled.addListener((details) => {
    void (async () => {
      await boot();
      if (details.reason === 'install' && !config.e2e) {
        const settings = await stores.settings.read();
        if (!settings.welcomed) {
          await stores.settings.update((s) => ({ ...s, welcomed: true }));
          await browser.tabs.create({
            url: browser.runtime.getURL('/welcome.html'),
          });
        }
      }
    })().catch(() => undefined);
  });
  browser.runtime.onStartup.addListener(() => {
    void boot().catch(() => undefined);
  });

  // ---------------------------------------------------------------- messages
  const status = async (): Promise<BridgeStatus> => {
    const [install, account, settings, allSites] = await Promise.all([
      stores.install.get(),
      stores.account.read(),
      stores.settings.read(),
      hasAllSites(),
    ]);
    const live = account && !account.needsReauth ? await auth?.session() : null;
    return {
      version,
      installId: install.id,
      connected: Boolean(live),
      email: account?.email ?? null,
      allSites,
      enabled: settings.enabled,
    };
  };

  const bridge: BridgeHandlers = {
    status,
    async connect(tokenHash, email) {
      if (!auth || !sync) return 'auth_failed';
      const result = await auth.connect(tokenHash, email);
      if (!result.ok) return 'auth_failed';
      await sync.connected(result.userId, result.email);
      await worker.profileChanged();
      return 'ok';
    },
    async disconnect() {
      await auth?.signOut();
      await sync?.signedOut(false);
      await worker.profileChanged();
    },
    async refresh() {
      if (!auth || !sync || !(await auth.session())) return false;
      await sync.refresh();
      await worker.profileChanged();
      return true;
    },
    async sites() {
      return listLocalSites(await stores.sites.all());
    },
    async siteUpdate(domain, change) {
      if (change.kind === 'forget') {
        const install = await stores.install.get();
        await stores.sites.forget(domain);
        await stores.events.forgetDomain(domain);
        await stores.receipts.forgetDomain(domain);
        await stores.answers.forgetSite(await siteKey(install.secret, domain));
      } else {
        const wasPaused = (await stores.sites.get(domain)).rule.paused;
        await stores.sites.update(domain, (s) => {
          switch (change.kind) {
            case 'pause':
              s.rule.paused = change.paused;
              break;
            case 'block':
              if (change.blocked) {
                s.rule.blocks = [...new Set([...s.rule.blocks, change.op])];
                s.rule.pins = s.rule.pins.filter((p) => p !== change.op);
              } else {
                s.rule.blocks = s.rule.blocks.filter((b) => b !== change.op);
                const dop = s.state.ops[change.op];
                if (dop) delete dop.block;
              }
              break;
            case 'pin': {
              const dop = s.state.ops[change.op];
              if (change.on) {
                s.rule.pins = [...new Set([...s.rule.pins, change.op])];
                s.rule.blocks = s.rule.blocks.filter((b) => b !== change.op);
                if (dop) delete dop.block;
              } else {
                s.rule.pins = s.rule.pins.filter((p) => p !== change.op);
                if (dop) delete dop.pin;
              }
              break;
            }
            case 'reset':
              resetRule(s, Date.now());
              break;
          }
          s.rule.updatedAt = Date.now();
        });
        // Open tabs on the site follow the new rule at once.
        if (change.kind === 'pause' && change.paused)
          await worker.pauseDomain(domain);
        else if (
          wasPaused &&
          (change.kind === 'pause' || change.kind === 'reset')
        )
          await worker.resumeDomain(domain);
        else if (change.kind === 'block' && change.blocked)
          await worker.blockOnDomain(domain, change.op);
        else await worker.replanDomain(domain);
      }
      await worker.reconcileRegistration();
      await worker.refreshAllBadges();
      return listLocalSites(await stores.sites.all());
    },
    async receipts() {
      return stores.receipts.list();
    },
    async clearLocal() {
      await clearLocalData(stores);
      await undos.clear();
      await local.remove([LEGACY_ANNOUNCED_KEY]).catch(() => undefined);
      // The profile is back to the basic fit and learning is gone: replan.
      await worker.profileChanged();
      await worker.reconcileRegistration(true);
      await worker.refreshAllBadges();
    },
    async openWelcome(focus) {
      const base = browser.runtime.getURL('/welcome.html');
      const url = focus === 'allow' ? `${base}#allow` : base;
      const open = (await browser.tabs.query({})).find(
        (t) => typeof t.id === 'number' && t.url?.startsWith(base),
      );
      if (open?.id === undefined) {
        await browser.tabs.create({ url });
        return;
      }
      // A new hash on the open page is a same-document navigation (no reload).
      await browser.tabs.update(open.id, {
        active: true,
        ...(focus === 'allow' && open.url !== url ? { url } : {}),
      });
      await browser.windows
        .update(open.windowId, { focused: true })
        .catch(() => undefined);
    },
  };

  const handleContent = async (
    m: ContentToWorker,
    sender: RuntimeSender,
  ): Promise<unknown> => {
    const tabId = sender.tab?.id;
    if (typeof tabId !== 'number') return undefined;
    const frameId = sender.frameId ?? 0;
    switch (m.type) {
      case 'cs:hello':
        return worker.hello(tabId, frameId, sender.url);
      case 'cs:signals':
        return worker.signals(tabId, frameId, m.signals, m.evidence);
      case 'cs:applied':
        await worker.applied(tabId, frameId, m.changes);
        return { ok: true };
      case 'cs:interaction':
        await worker.interacted(tabId, frameId, m.tabSession);
        return { ok: true };
      case 'cs:event':
        await worker.contentEvent(tabId, frameId, m.event);
        return { ok: true };
      case 'cs:friction':
        return worker.friction(tabId, m.signal, m.ops);
      case 'cs:offer-answer':
        return worker.offerAnswer(tabId, m.op, m.answer, 'page');
      case 'cs:undo-all':
        await worker.undoAllOnPage(tabId, frameId);
        return { ok: true };
    }
  };

  const handleUi = async (m: UiMessage): Promise<unknown> => {
    switch (m.type) {
      case 'ui:view':
        return worker.view(m.tabId);
      case 'ui:undo':
        await worker.undo(m.tabId, m.op);
        return worker.view(m.tabId);
      case 'ui:undo-reason':
        await worker.undoReason(m.tabId, m.op, m.reason);
        return worker.view(m.tabId);
      case 'ui:set-level':
        await worker.setLevel(m.tabId, m.op, m.level, m.scope);
        return worker.view(m.tabId);
      case 'ui:toggle-op':
        await worker.toggleOps(m.tabId, [m.op], m.on, m.scope);
        return worker.view(m.tabId);
      case 'ui:quick':
        await worker.quick(m.tabId, m.key, m.on);
        return worker.view(m.tabId);
      case 'ui:use-everywhere':
        await worker.useEverywhere(m.tabId);
        return worker.view(m.tabId);
      case 'ui:pause-site':
        await worker.pauseSite(m.tabId, m.paused);
        return worker.view(m.tabId);
      case 'ui:enabled':
        await worker.setEnabled(m.enabled);
        return { ok: true };
      case 'ui:offer-answer':
        await worker.offerAnswer(m.tabId, m.op, m.answer, 'popup');
        return worker.view(m.tabId);
      case 'ui:offer-seen':
        await worker.markOfferShown(m.tabId);
        return { ok: true };
      case 'ui:rate':
        await worker.rate(m.tabId, m.op, m.rating);
        return { ok: true };
      case 'ui:show-on-page':
        return worker.showOnPage(m.tabId, m.op, m.on);
      case 'ui:redo':
        await worker.redo(m.tabId, m.op);
        return worker.view(m.tabId);
      case 'ui:grant-site':
        await worker.grantSite(m.tabId);
        return worker.view(m.tabId);
      case 'ui:clear-everywhere':
        await worker.clearEverywhere();
        return { ok: true };
      case 'ui:reading-guide':
        return (
          (await port.sendToTab(m.tabId, {
            type: 'sw:reading-guide',
            on: m.on,
          })) ?? {
            ok: false,
          }
        );
      case 'ui:grant-all-sites':
        return worker.grantedAllSites();
      case 'ui:receipts':
        return stores.receipts.list();
      case 'ui:sign-out':
        await bridge.disconnect();
        return { ok: true };
      case 'ui:prefs':
        return worker.prefs();
      case 'ui:set-prefs':
        return worker.setPrefs(m);
      case 'ui:system': {
        const signals = normalizeSystem(m.signals);
        if (signals) await worker.system(signals);
        return { ok: true };
      }
      case 'ui:welcome':
        return worker.welcome();
      case 'e2e:seed':
        return config.e2e
          ? worker.e2eSeed({
              ...(m.profile !== undefined ? { profile: m.profile } : {}),
              ...(m.account !== undefined ? { account: m.account } : {}),
              reset: m.reset === true,
            })
          : { ok: false };
      case 'e2e:state':
        return config.e2e
          ? {
              tabs: await tabs.all(),
              registered: await browser.scripting
                .getRegisteredContentScripts()
                .catch(() => []),
              events: await stores.events.list(),
            }
          : { ok: false };
    }
  };

  browser.runtime.onMessage.addListener(
    (msg: unknown, sender: RuntimeSender, sendResponse: SendResponse) => {
      const kind = senderKind(sender, browser.runtime.id);
      let work: Promise<unknown> | null = null;
      if (kind === 'content') {
        const m = parseContent(msg);
        if (m) work = handleContent(m, sender);
      } else if (kind === 'page') {
        const m = parseUi(msg, config.e2e);
        if (m) work = handleUi(m);
      }
      if (!work) return undefined;
      work.then(
        (reply) => sendResponse(reply),
        () => sendResponse({ ok: false, error: 'internal' }),
      );
      return true;
    },
  );

  browser.runtime.onMessageExternal.addListener(
    (msg: unknown, sender: RuntimeSender, sendResponse: SendResponse) => {
      void handleBridge(msg, sender, config.bridgePatterns, bridge).then(
        sendResponse,
        () =>
          sendResponse({
            ok: false,
            error: { code: 'internal', message: 'Something went wrong.' },
          }),
      );
      return true;
    },
  );

  // ---------------------------------------------------------------- browser events
  browser.permissions.onAdded.addListener(() => {
    void worker.permissionsChanged().catch(() => undefined);
  });
  browser.permissions.onRemoved.addListener(() => {
    void worker.permissionsChanged().catch(() => undefined);
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void worker.tabClosed(tabId).catch(() => undefined);
  });
  browser.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    // A prerendered page commits in the background while the tab still shows
    // the current page; its engine says hello when it is shown.
    if (
      (details as { documentLifecycle?: string }).documentLifecycle ===
      'prerender'
    )
      return;
    void worker
      .navigated(
        details.tabId,
        details.url,
        details.timeStamp,
        details.transitionQualifiers ?? [],
      )
      .catch(() => undefined);
  });
  browser.webNavigation.onDOMContentLoaded.addListener((details) => {
    if (details.frameId !== 0 || details.documentLifecycle === 'prerender')
      return;
    void worker.pageLoaded(details.tabId).catch(() => undefined);
  });
  browser.webNavigation.onCompleted.addListener((details) => {
    if (details.frameId !== 0 || details.documentLifecycle === 'prerender')
      return;
    void worker.pageLoaded(details.tabId).catch(() => undefined);
  });
  browser.alarms.onAlarm.addListener((alarm) => {
    void (async () => {
      await worker.flushUndos();
      if (alarm.name === ALARMS.auth.name) await auth?.refresh();
      if (
        alarm.name === ALARMS.sync.name &&
        auth &&
        sync &&
        (await auth.session())
      ) {
        const result = await sync.refresh();
        if (result.profileChanged) await worker.profileChanged();
      }
    })().catch(() => undefined);
  });
  browser.commands.onCommand.addListener((command, tab) => {
    void (async () => {
      const tabId = tab?.id ?? (await port.activeTabId());
      if (typeof tabId !== 'number') return;
      if (command === 'focus-layer') await worker.focusLayer(tabId);
      if (command === 'undo-all') await worker.undo(tabId, 'all');
    })().catch(() => undefined);
  });

  void boot().catch(() => undefined);
}
