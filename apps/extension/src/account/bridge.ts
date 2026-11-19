// The website's link to this extension (chrome.runtime.onMessageExternal, `wa:*` in core's bridge protocol).
//
// - Connect: the website mints a single-use sign-in token for the signed-in person; the worker exchanges it for its
//   own session (verifyOtp, magiclink). The website's own session is never shared. The session is kept in
//   chrome.storage.local, which content scripts of web pages cannot read.
// - The fit Tune saved to the account (`fit_profiles`, is_current) is pulled on connect, on `wa:refresh` (the website
//   sends it after Tune saves) and when Chrome starts, and becomes the extension's fit when it is newer than the one
//   here. A warm-up done in the extension later is kept: the same account version is never applied twice.
// - Sites: the website's sites page reads and changes paused sites. The list of sites never leaves this browser.
// - Only origins in externally_connectable are answered (Chrome checks; this checks again).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  bridgeRequestSchema,
  type BridgeErrorCode,
  type BridgeRequest,
  type BridgeStatus,
  type LocalSite,
} from '@webable/core/bridge/protocol';
import type { Database } from '@webable/core/db/types';
import type { FitProfile, Settings } from '@webable/engine';

import { originAllowed, readAccountConfig } from './config';
import { fromAccountFit, parseAccountFit } from './fit';
import { domainOf, siteList } from './sites';

export interface AccountDeps {
  getFit(): Promise<FitProfile | null>;
  setFit(fit: FitProfile | null): Promise<unknown>;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<Settings>;
  /** Open (or focus) the extension's own setup page. */
  openFitting(): Promise<void>;
}

interface AccountRecord {
  userId: string;
  email: string;
  /** The account fit version last applied here (null: none yet). */
  fitVersion: number | null;
  installRegistered: boolean;
}

const ACCOUNT_KEY = 'account';
const AUTH_KEY = 'accountAuth';
const INSTALL_KEY = 'installId';
const SITE_PREFS_KEY = 'sitePrefs';
/** What `wa:clear-local` removes: everything learned or chosen on this browser, not the sign-in. */
const LOCAL_DATA_KEYS = [
  'fit',
  SITE_PREFS_KEY,
  'passiveStore',
  'passive',
  'passiveRefit',
  'passiveOffers',
  'passiveSeen',
  'reader',
];

class BridgeFail extends Error {
  constructor(
    readonly code: BridgeErrorCode,
    message: string,
  ) {
    super(message);
  }
}

/* ------------------------------------------------------------------ */
/* Storage                                                             */
/* ------------------------------------------------------------------ */

async function readAccount(): Promise<AccountRecord | null> {
  const got = await chrome.storage.local.get(ACCOUNT_KEY);
  const a = got[ACCOUNT_KEY] as Partial<AccountRecord> | undefined;
  return a && typeof a.userId === 'string' && typeof a.email === 'string'
    ? {
        userId: a.userId,
        email: a.email,
        fitVersion: typeof a.fitVersion === 'number' ? a.fitVersion : null,
        installRegistered: a.installRegistered === true,
      }
    : null;
}

const writeAccount = (a: AccountRecord | null): Promise<void> =>
  a === null
    ? chrome.storage.local.remove(ACCOUNT_KEY)
    : chrome.storage.local.set({ [ACCOUNT_KEY]: a });

async function installId(): Promise<string> {
  const got = await chrome.storage.local.get(INSTALL_KEY);
  const id = got[INSTALL_KEY];
  if (typeof id === 'string' && id) return id;
  const made = crypto.randomUUID();
  await chrome.storage.local.set({ [INSTALL_KEY]: made });
  return made;
}

/** supabase-js session storage over chrome.storage.local (trusted contexts only). */
const authStorage = {
  async getItem(key: string): Promise<string | null> {
    const got = await chrome.storage.local.get(key);
    const v = got[key];
    return typeof v === 'string' ? v : null;
  },
  async setItem(key: string, value: string): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  },
  async removeItem(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  },
};

function platform(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (/Macintosh|Mac OS X/.test(ua)) return 'macos';
  if (/Windows/.test(ua)) return 'windows';
  if (/CrOS/.test(ua)) return 'chromeos';
  if (/Android/.test(ua)) return 'android';
  if (/Linux/.test(ua)) return 'linux';
  return 'other';
}

/* ------------------------------------------------------------------ */
/* Sites                                                               */
/* ------------------------------------------------------------------ */

async function sitePrefs(): Promise<Record<string, unknown>> {
  const got = await chrome.storage.local.get(SITE_PREFS_KEY);
  return { ...((got[SITE_PREFS_KEY] ?? {}) as Record<string, unknown>) };
}

/* ------------------------------------------------------------------ */
/* The bridge                                                          */
/* ------------------------------------------------------------------ */

export function registerAccountBridge(deps: AccountDeps): void {
  const config = readAccountConfig();
  const configured = config.supabaseUrl !== '' && config.publishableKey !== '';
  let client: SupabaseClient<Database> | null = null;
  const db = (): SupabaseClient<Database> => {
    if (!configured)
      throw new BridgeFail('internal', 'This build has no account settings');
    client ??= createClient<Database>(
      config.supabaseUrl,
      config.publishableKey,
      {
        auth: {
          storage: authStorage,
          storageKey: AUTH_KEY,
          persistSession: true,
          // A service worker cannot keep a refresh timer alive: getSession() refreshes when it is needed.
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
        global: { headers: { 'x-client-info': 'webable-extension' } },
      },
    );
    return client;
  };

  async function signedIn(): Promise<boolean> {
    if (!configured) return false;
    try {
      const { data } = await db().auth.getSession();
      return data.session !== null;
    } catch {
      return false;
    }
  }

  async function status(): Promise<BridgeStatus> {
    const [account, settings, id] = await Promise.all([
      readAccount(),
      deps.getSettings(),
      installId(),
    ]);
    const connected = account !== null && (await signedIn());
    const allSites = await chrome.permissions
      .contains({ origins: ['<all_urls>'] })
      .catch(() => false);
    return {
      version: chrome.runtime.getManifest().version,
      installId: id,
      connected,
      email: connected ? account.email : null,
      allSites,
      enabled: settings.enabled,
    };
  }

  /** The account's current fit becomes this extension's fit when it is a new version and newer than the one here. */
  async function pullFit(account: AccountRecord): Promise<AccountRecord> {
    const { data, error } = await db()
      .from('fit_profiles')
      .select('version, profile')
      .eq('is_current', true)
      .maybeSingle();
    if (error) throw new BridgeFail('internal', 'Could not read the fit');
    if (!data || data.version === account.fitVersion) return account;
    const acc = parseAccountFit(data.profile);
    if (!acc) return account;
    const local = await deps.getFit();
    const localAt = local ? Date.parse(local.createdAt) : NaN;
    const accountAt = Date.parse(acc.createdAt);
    if (!local || !(localAt > accountAt))
      await deps.setFit(fromAccountFit(acc));
    const next = { ...account, fitVersion: data.version };
    await writeAccount(next);
    return next;
  }

  async function registerInstall(account: AccountRecord): Promise<void> {
    const now = new Date().toISOString();
    const version = chrome.runtime.getManifest().version.slice(0, 32);
    const id = await installId();
    if (!account.installRegistered) {
      const { error } = await db().from('extension_installs').upsert(
        {
          id,
          user_id: account.userId,
          browser: 'chrome',
          platform: platform(),
          extension_version: version,
          last_seen_at: now,
        },
        { onConflict: 'id' },
      );
      if (!error) await writeAccount({ ...account, installRegistered: true });
      return;
    }
    // A row removed on the website stays removed: update only, never re-create.
    await db()
      .from('extension_installs')
      .update({
        platform: platform(),
        extension_version: version,
        last_seen_at: now,
      })
      .eq('id', id);
  }

  async function connect(
    tokenHash: string,
    email: string,
  ): Promise<BridgeStatus> {
    const auth = db().auth;
    let userId: string;
    let actual: string;
    try {
      const { data, error } = await auth.verifyOtp({
        type: 'magiclink',
        token_hash: tokenHash,
      });
      const user = data.user ?? data.session?.user ?? null;
      if (error || !data.session || !user)
        throw new BridgeFail(
          'auth_failed',
          'The sign-in link was not accepted',
        );
      userId = user.id;
      actual = (user.email ?? '').toLowerCase();
    } catch (err) {
      if (err instanceof BridgeFail) throw err;
      throw new BridgeFail('auth_failed', 'The sign-in link was not accepted');
    }
    if (actual !== email.toLowerCase()) {
      // The token was not for the person the website says is signed in.
      await auth.signOut({ scope: 'local' }).catch(() => undefined);
      throw new BridgeFail(
        'auth_failed',
        'The sign-in link was for another account',
      );
    }
    const before = await readAccount();
    let account: AccountRecord =
      before && before.userId === userId
        ? { ...before, email: actual }
        : { userId, email: actual, fitVersion: null, installRegistered: false };
    await writeAccount(account);
    await registerInstall(account).catch(() => undefined);
    account = (await readAccount()) ?? account;
    await pullFit(account).catch(() => undefined);
    return status();
  }

  async function disconnect(): Promise<BridgeStatus> {
    if (configured)
      await db()
        .auth.signOut({ scope: 'local' })
        .catch(() => chrome.storage.local.remove(AUTH_KEY));
    // The fit stays on this device.
    await writeAccount(null);
    return status();
  }

  async function refresh(): Promise<BridgeStatus> {
    const account = await readAccount();
    if (!account || !(await signedIn()))
      throw new BridgeFail('not_connected', 'Not connected');
    const next = await pullFit(account);
    await registerInstall(next).catch(() => undefined);
    return status();
  }

  async function sites(): Promise<LocalSite[]> {
    const settings = await deps.getSettings();
    return siteList(settings.pausedOrigins, await sitePrefs());
  }

  async function siteUpdate(
    req: Extract<BridgeRequest, { type: 'wa:site-update' }>,
  ): Promise<LocalSite[]> {
    const domain = domainOf(req.domain);
    const settings = await deps.getSettings();
    const others = settings.pausedOrigins.filter((e) => domainOf(e) !== domain);
    const change = req.change;
    if (change.kind === 'pause') {
      await deps.setSettings({
        pausedOrigins: change.paused ? [...others, domain] : others,
      });
    } else if (change.kind === 'forget' || change.kind === 'reset') {
      await deps.setSettings({ pausedOrigins: others });
      const prefs = await sitePrefs();
      for (const k of Object.keys(prefs))
        if (domainOf(k) === domain) delete prefs[k];
      await chrome.storage.local.set({ [SITE_PREFS_KEY]: prefs });
    }
    // 'block' and 'pin' name v1 adaptations this engine does not have: nothing to change.
    return sites();
  }

  async function clearLocal(): Promise<BridgeStatus> {
    await chrome.storage.local.remove(LOCAL_DATA_KEYS);
    await deps.setSettings({ pausedOrigins: [] });
    await deps.setFit(null);
    return status();
  }

  async function handle(req: BridgeRequest): Promise<unknown> {
    switch (req.type) {
      case 'wa:ping':
        return status();
      case 'wa:connect':
        return connect(req.tokenHash, req.email);
      case 'wa:disconnect':
        return disconnect();
      case 'wa:refresh':
        return refresh();
      case 'wa:sites':
        return sites();
      case 'wa:site-update':
        return siteUpdate(req);
      case 'wa:receipts':
        // This extension keeps no copies of what it sends (page outlines go to WebAble's own server for reading).
        return [];
      case 'wa:clear-local':
        return clearLocal();
      case 'wa:open-welcome':
        await deps.openFitting();
        return { ok: true };
    }
  }

  chrome.runtime.onMessageExternal.addListener(
    (msg: unknown, sender, sendResponse) => {
      const origin =
        sender.origin ??
        (URL.canParse(sender.url ?? '')
          ? new URL(sender.url!).origin
          : undefined);
      const reply = (code: BridgeErrorCode, message: string) =>
        sendResponse({ ok: false, error: { code, message } });
      if (!originAllowed(origin, config.bridgePatterns)) {
        reply('forbidden_origin', 'This page may not message WebAble');
        return false;
      }
      const parsed = bridgeRequestSchema.safeParse(msg);
      if (!parsed.success) {
        reply('bad_request', 'Not a WebAble request');
        return false;
      }
      handle(parsed.data).then(
        (data) => sendResponse({ ok: true, data }),
        (err: unknown) =>
          err instanceof BridgeFail
            ? reply(err.code, err.message)
            : reply('internal', 'Something went wrong'),
      );
      return true; // async reply
    },
  );

  // Chrome started: pick up a fit saved on another computer since last time.
  chrome.runtime.onStartup.addListener(() => {
    void (async () => {
      const account = await readAccount();
      if (account && (await signedIn())) {
        const next = await pullFit(account);
        await registerInstall(next);
      }
    })().catch(() => undefined);
  });
}
