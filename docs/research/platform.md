# WebAble: platform facts for a production build (verified 2026-09-28)

Scope: Chrome MV3 extension platform, Supabase (auth, keys, Edge Functions, RLS, CLI, testing), and the current JS toolchain. I checked everything against primary docs, the npm registry (`npm view … time`), chromiumdash, or the package source, and each section names what it rests on. Anything I could not verify directly is labelled **UNVERIFIED** or **SPIKE**.

---

## 0. Decisions in one screen

| # | Decision | Why (short) |
|---|---|---|
| D1 | Put **no** `host_permissions` and **no** static `content_scripts` in the manifest. Declare `optional_host_permissions: ["<all_urls>"]` (or `["https://*/*","http://*/*"]`), call `permissions.request()` from a click on the onboarding/side-panel button, then run `scripting.registerContentScripts({… runAt:"document_start", persistAcrossSessions:true})`. | Install shows **no** "Read and change all your data on all websites" warning, so the warning appears in context with a WebAble explanation. Updates never disable the extension over optional permissions. The CWS review is lighter (see §2.3). |
| D2 | **WXT gotcha:** a `defineContentScript({ registration: 'runtime', matches: [...] })` makes WXT copy `matches` into **required** `host_permissions`. I confirmed this in the wxt@0.21.4 source (`core/utils/manifest.mjs`). Leave `matches` out of the definition, register from the service worker yourself, and add a CI assertion on the built manifest. | Otherwise D1 is silently undone. |
| D3 | For "value on first visit" with no flash of the unadapted page, register a **bounded set of reviewed static CSS variant files** through `registerContentScripts({css:[…]})`. The docs say these are injected "before any DOM is constructed or displayed". Swap them with `updateContentScripts` when the profile changes. Save `insertCSS({origin:'USER'})` for per-page AI-selected operations. | Async storage reads, SW round-trips and AI calls cannot beat first paint, but manifest-registered CSS can. |
| D4 | **Auth:** the extension gets its **own** Supabase session, never a copy of the web app's refresh token. The web app server mints a single-use `hashed_token` (`auth.admin.generateLink({type:'magiclink'})`) and sends it to the extension through `externally_connectable` → `runtime.onMessageExternal`. The extension service worker calls `auth.verifyOtp({ token_hash, type })`. | Refresh tokens are single-use with reuse detection, so sharing one token is fragile. Web `signOut()` defaults to `scope:'global'`. A handoff needs no code typing, which matters for fine-motor users. |
| D5 | The extension **service worker is the only Supabase Auth client** (custom `chrome.storage.local` adapter, `autoRefreshToken:false`, refresh on demand via `getSession()`). Side panel and popup use `createClient(url, key, { accessToken: () => askSW() })`. Content scripts never see tokens; call `storage.local.setAccessLevel('TRUSTED_CONTEXTS')`. | MV3 service workers die after 30 s idle, so timers are unreliable. supabase-js ≥2.107 is lockless, so several auth clients sharing one storage would race each other. |
| D6 | Start on **new API keys** (`sb_publishable_…` / `sb_secret_…`) and **asymmetric ES256 JWT signing keys**. Edge Functions use `@supabase/server` (`withSupabase`/`createSupabaseContext`, `auth:'user'`) or `jose` + JWKS. | Legacy `anon`/`service_role` keys "keep working until the end of 2026". JWKS verification is local and fast, and `getClaims()` avoids an Auth-server round trip. |
| D7 | Run RLS and migration tests **without Docker** on **PGlite 0.5.8 + `@electric-sql/pglite-pgtap`** (I verified this locally, §3.9), plus a persistent hosted **branch** for integration. `pg-mem` is unsuitable because it has no RLS. | No Docker on the dev machine. `supabase start/db reset/db diff` need Docker. |
| D8 | Toolchain: Node **24 LTS**, Next **16.3.6** (`proxy.ts`), React **19.3.0**, WXT **0.21.4**, Vite **8.3.1**, TS **7.0.2** alongside **6.0.x** (see §4), Zod **4.6.5**, RAC **1.21.1**, Motion **13.4.4**, Playwright **1.63.0**, Vitest **5.0.2**, supabase-js **2.117.2**, @supabase/ssr **0.12.7**, Supabase CLI **2.118.0**. | All are current `latest` stable as of 2026-09-28 (§1). |

---

## 1. Version matrix (npm registry, 2026-09-28)

| Package | `latest` | Published | Major line started | Notes / breaking |
|---|---|---|---|---|
| next | **16.3.6** | 2026-09-22 | 16.0.0 on 2025-10-22 | 16.3 released 2026-08-03. 16.4 is in canary. Node ≥20.9, TS ≥5.1. Details in §4.1. |
| react / react-dom | **19.3.0** | 2026-09-09 | 19.0.0 on 2024-12-05 | 19.3 made `<ViewTransition>` and Fragment refs stable and added `browser()` (react-dom), `addTransitionType`, and Trusted Types pass-through. The post lists no breaking changes. |
| wxt | **0.21.4** | 2026-08-11 | (0.x) | 0.21 requires Node ≥22. Its peers are `vite ^6.3.4 ‖ ^7 ‖ ^8.0.0-0` and `typescript >=5.4` (optional), with web-ext optional. `url:` imports were removed, and content scripts get no global by default. 0.20 removed webextension-polyfill (`browser` now comes from `@wxt-dev/browser`). |
| @wxt-dev/module-react | 1.2.2 | | | |
| vite | **8.3.1** | 2026-09-24 | 8.0.0 on 2026-03-12 | Rolldown is the single bundler and Oxc handles transforms. Node 20.19+ or 22.12+. The install is about 15 MB larger (lightningcss). |
| typescript | **7.0.2** | 2026-07-08 | 7.0.2 | Native Go port with **no stable JS API**. typescript-eslint 8.71 peers `typescript <6.1.0`. §4.2 has details. |
| @typescript/typescript6 | 6.0.2 (typescript@6.0.3 also exists) | | | Microsoft's recommended alias for API consumers. |
| zod | **4.6.5** | 2026-09-13 | 4.0.0 on 2025-07-09 | `z.email()` and friends, `error` param, `z.strictObject/looseObject`, two-argument `z.record`, `z.toJSONSchema()`. |
| react-aria-components | **1.21.1** | 2026-09-04 | 1.0 on 2023-12 | Peers React 16.8–19. 1.21 added NavigationTree, Menu async loading and `renderEmptyState`. 1.20 added PreviewTrigger, TokenField (alpha) and context-menu MenuTrigger. The `3.0.0-nightly` tag exists, but avoid nightly. |
| motion | **13.4.4** | 2026-09-25 | 13.0.0 on 2026-08-05 | Import from `motion/react`. v13 dropped the optional `@emotion/is-prop-valid` (inject it through `MotionConfig` if you need it). |
| @playwright/test | **1.63.0** | 2026-09-04 | | Chromium 153. Ubuntu 20.04 support dropped, and experimental CT packages are deprecated in favor of the stories model (1.62). |
| vitest | **5.0.2** | 2026-09-25 | 5.0.0 on 2026-09-03 | Vite ≥6.4, Node ≥22.12. `clearMocks` is on by default, `vi.mock` must be top-level, `expect.poll` fails on timeout, browser-mode `render()` is async, and artifacts go to `.vitest/`. |
| @supabase/supabase-js | **2.117.2** | 2026-09-25 | 2.0 on 2022-10 | Lockless auth coordination since 2.107.0 (the `lock` option is deprecated). `getClaims()`. A `3.0.0-next.29` tag exists; stay on 2.x. |
| @supabase/ssr | **0.12.7** | 2026-09-08 | | |
| @supabase/server | **1.8.1** | 2026-09-28 | 0.1.0-alpha on 2026-03-24 | `withSupabase`, `createSupabaseContext`, `fromSupabaseUrl`. Depends on `jose ^6.2`. This is the "recommended approach for new functions" in the Supabase docs. |
| supabase (CLI) | **2.118.0** | 2026-09-25 | 2.0 on 2024-12 | 2.119 is in beta. |
| @electric-sql/pglite | **0.5.8** | 2026-08-26 | | Embeds **PostgreSQL 18.3** (wasm32). Hosted Supabase is PG 17, so watch for differences. |
| jose | 6.2.12 | 2026-09-05 | | |
| pg-mem | 3.0.14 | 2026-02-26 | | No RLS (its bundle contains zero references to "policy"). Don't use it for policy tests. |
| Node.js | **24.21.0 "Krypton" LTS** | 2026-09-07 | | 22.x "Jod" is maintenance LTS. 26.x is Current and becomes LTS in Oct 2026. Pick 24 LTS, which satisfies Next (≥20.9), WXT (≥22), Vitest 5 (≥22.12) and Vite 8. |
| Chrome stable | **154** (2026-09-22) | | | Chrome moved to a **2-week** major cadence starting with 153 (2026-09-08). 155 is due 2026-10-06 and 156 on 2026-10-20 (chromiumdash). |

Sources: npm registry (`npm view <pkg> time`); https://chromiumdash.appspot.com/fetch_milestone_schedule; https://developer.chrome.com/blog/chrome-two-week-start; https://nodejs.org/dist/index.json.

---

## 2. Chrome MV3 extension platform

### 2.1 Running automatically on every page: the options compared

| | A. Static `content_scripts` + `host_permissions` | B. `optional_host_permissions` + `permissions.request()` + `scripting.registerContentScripts` (**recommended**) | C. `activeTab` only |
|---|---|---|---|
| Install-time warning | Yes. `content_scripts.matches` "will trigger a warning", and `<all_urls>` shows "Read and change all your data on all websites" | **None at install.** The prompt appears at runtime when you call `request()`. | None |
| Runs automatically on every page | Yes | Yes, once granted (registered scripts persist; `persistAcrossSessions` defaults to `true`) | No. It needs a click on each page, which fails "value on first visit". |
| Effect of an update that adds permissions | "the extension will be disabled until the user accepts the new permission" | "Chrome won't disable it for your users if the upgrade adds optional rather than required permissions" | n/a |
| Already-open tabs | Not injected until reload | Not injected. Use `scripting.executeScript` after the grant. | n/a |
| User can later restrict site access | Yes (the "On click / On specific sites / On all sites" controls) | Yes. Handle `permissions.onRemoved`. | n/a |
| CWS review | "Reviews may take longer for extensions that request broad host permissions" | Chrome DevRel on the chromium-extensions group describes this as the pattern that avoids the broad-host in-depth-review delay. That is **not written in the official review-process doc** (UNVERIFIED as policy). Justification is still required. | Fastest |

Facts (developer.chrome.com, scripting and content-scripts references):
- `registerContentScripts` has been available since Chrome 96. It takes `RegisteredContentScript` fields `id`, `js`, `css`, `matches`, `excludeMatches`, `allFrames`, `matchOriginAsFallback` (Chrome 119+), `runAt` (default `document_idle`), `world` (default `ISOLATED`, Chrome 102+) and `persistAcrossSessions` (**default `true`**).
- Registration **does not inject into tabs that are already open**. Use `executeScript` for those.
- `registerContentScripts` "itself doesn't display any warning, but without host permission it doesn't work".
- `permissions.request()` "must be requested from inside a user gesture". Chrome 133+ adds `permissions.addHostAccessRequest()`/`removeHostAccessRequest()`, which surface per-site access requests in Chrome's UI. That is useful if a user granted "on click" only.

Recommended implementation (WXT, service worker):

```ts
// wxt.config.ts: no host_permissions, no static content_scripts
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    minimum_chrome_version: '148',            // browser namespace + promise-returning onMessage (see 2.12)
    permissions: ['storage', 'scripting', 'sidePanel', 'alarms'], // none of these show install warnings
    optional_host_permissions: ['<all_urls>'],
    externally_connectable: { matches: ['https://app.webable.example/*', 'http://localhost/*'] },
    // Pin a dev key so the extension ID is stable for externally_connectable + Supabase CORS allowlists
  },
  hooks: {
    'build:manifestGenerated': (_wxt, manifest) => {
      if (manifest.host_permissions?.length || manifest.content_scripts?.length)
        throw new Error('Broad host permissions leaked into required manifest keys'); // guards D2
    },
  },
});

// entrypoints/adapter.content.ts
export default defineContentScript({ registration: 'runtime', runAt: 'document_start', main(ctx) { /* … */ } });
// Leave `matches` out on purpose. WXT 0.21 validation allows matches==null only for runtime registration,
// and if matches were given WXT would add them to host_permissions.

// entrypoints/background.ts
const SCRIPT_ID = 'webable-adapter';
const ORIGINS = ['<all_urls>'];

async function ensureRegistered() {
  if (!(await browser.permissions.contains({ origins: ORIGINS }))) return;
  const existing = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  const def = {
    id: SCRIPT_ID, matches: ORIGINS, js: ['content-scripts/adapter.js'],
    css: await currentProfileCssVariants(),   // D3: e.g. ['profile-css/text-lg.css','profile-css/spacing-2.css']
    runAt: 'document_start' as const, allFrames: false, persistAcrossSessions: true,
  };
  existing.length ? await browser.scripting.updateContentScripts([def])
                  : await browser.scripting.registerContentScripts([def]);
}
// Register every listener synchronously at the top level (MV3 SW rule)
browser.runtime.onInstalled.addListener(ensureRegistered);   // reconcile after install/update
browser.runtime.onStartup.addListener(ensureRegistered);
browser.permissions.onAdded.addListener(async () => { await ensureRegistered(); /* executeScript into open tabs */ });
browser.permissions.onRemoved.addListener(() =>
  browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] }).catch(() => {}));

// Side panel / onboarding button (the call must run inside the click handler):
// await browser.permissions.request({ origins: ['<all_urls>'] });
```

Notes:
- `<all_urls>` also matches `file:` URLs, which additionally need the user to enable "Allow access to file URLs". `["https://*/*","http://*/*"]` is the narrower equivalent, and the Chrome docs show it for runtime-discovered hosts.
- Reconcile on `onInstalled` and `onStartup` rather than assuming registrations survive every update path. **UNVERIFIED**: whether dynamic registrations persist across *extension updates* in every Chrome version.
- Sources: https://developer.chrome.com/docs/extensions/reference/api/scripting ; https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts ; https://developer.chrome.com/docs/extensions/reference/api/permissions ; https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings ; https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts ; https://developer.chrome.com/docs/webstore/review-process ; WXT source `wxt@0.21.4/dist/core/utils/{manifest,validation}.mjs`.

### 2.2 Install-time warnings (permissions list)
- No warning: `scripting`, `storage`, `sidePanel`, `activeTab`, `alarms`, `identity`, `offscreen`.
- `tabs` shows "Read your browsing history". It is not needed: `tabId` and `status` are available without it, and host permission reveals the URL.
- `webNavigation` also warns about browsing history, so avoid it.
- `declarativeNetRequest` shows "Block content on any page".
- Host permissions shown as a warning at install or runtime: "Read and change all your data on all websites" (`<all_urls>`), or a per-site string.
- Source: https://developer.chrome.com/docs/extensions/reference/permissions-list

### 2.3 Chrome Web Store review and policy implications
- Review "for most extensions … within a few days, but it can take up to a few weeks". It "may take longer for extensions that request broad host permissions or sensitive execution permissions, or which include a lot of code or hard-to-review code". Minification is fine and obfuscation is not. (https://developer.chrome.com/docs/webstore/review-process)
- **Remote code:** "the full functionality of an extension must be easily discernible from its submitted code". Fetching *data* such as config or model outputs is permitted. This matches the "model emits data, never code" invariant: the AI returns operation IDs and parameters validated against a bundled Zod schema. (https://developer.chrome.com/docs/webstore/program-policies/policies)
- **User data:** page features count as "website content". You must prominently disclose collection and obtain "affirmative and informed consent", both on the listing and **in the product**. Limited Use applies: single-purpose use only, no sale or transfer except as the core service needs (an AI provider behind the Edge Function qualifies), no human reading without consent, and an affirmative Limited Use statement in the privacy policy. (https://developer.chrome.com/docs/webstore/program-policies/limited-use)
- **Single purpose / narrowest permissions:** justify each permission in the dashboard's Privacy tab.
- CWS dashboard changes in 2026: developer roles without the $5 fee (Apr 2026), in-dashboard appeals (Apr 2026), private publishing to external orgs (Feb 2026). (https://developer.chrome.com/docs/extensions/whats-new)

### 2.4 `chrome.storage.session` vs `local`
| | session | local |
|---|---|---|
| Persistence | In memory only. Cleared on browser restart, extension reload/update/disable. | On disk. "cleared when the extension is removed". |
| Quota | 10 MB (1 MB in ≤111) | 10 MB (5 MB in ≤113). Unlimited with `unlimitedStorage`. |
| Default content-script access | **Trusted contexts only** (change with `setAccessLevel`) | **Exposed to content scripts** by default. Restrict with `chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })`. |
| Encryption | Not encrypted. The docs say to use `storage.session` for sensitive user data. | Not encrypted |

- WebAble use: Supabase session in `local` (restricted to trusted contexts). Per-tab ephemeral state such as applied-ops summaries and undo pointers in `session`. A client-side LRU decision cache keyed by page-feature hash goes in `local`. **Do not store URLs or raw DOM.**
- Source: https://developer.chrome.com/docs/extensions/reference/api/storage

### 2.5 Service-worker lifecycle (constraints for the AI round trip)
- Termination triggers: 30 s of inactivity (events and extension API calls reset the timer, Chrome 110+); a single event or API call taking over 5 min; **a `fetch()` response taking more than 30 s to arrive**.
- Keepalive sources: WebSocket traffic (116+), ports no longer reset timers on open (114), offscreen document messages (109), and native messaging (105).
- The minimum `chrome.alarms` period is 30 s (120+). Alarm names are capped at 1024 bytes (150).
- What this means for WebAble:
  - Put a hard timeout of about 8–10 s on AI calls (`AbortSignal.timeout`). Degrade to the deterministic baseline.
  - Keep no global state that must survive; rehydrate from storage.
  - Register every listener synchronously at the top level.
  - supabase-js `autoRefreshToken` uses a 30 s `setInterval` ticker (`AUTO_REFRESH_TICK_DURATION_MS`), which the SW cannot keep alive. Set it to `false` and let `getSession()` refresh on demand. It refreshes when the token is within `EXPIRY_MARGIN_MS` = 90 s of expiry.
- Source: https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle ; auth-js 2.117.2 `lib/constants.js`.

### 2.6 `scripting.insertCSS` with `origin: 'USER'`
- `StyleOrigin` is `"AUTHOR"` (default) or `"USER"`. `removeCSS` must match `css`/`files`/**`origin`** exactly. It needs `scripting` plus host permission or `activeTab`, and it is called from the SW or an extension page, not from a content script. (https://developer.chrome.com/docs/extensions/reference/api/scripting)
- CSS cascade semantics (CSS Cascade spec): normal declarations rank UA < **user** < author, while `!important` declarations rank author < **user** < UA.
  - A USER sheet **only beats page styles with `!important`**.
  - `USER !important` beats even `author !important` (for example a site's `color: #999 !important`), so low-vision overrides (min font size, contrast, spacing) belong in USER + `!important`.
  - Non-important USER rules act as "defaults the page can override", which is useful for gentle suggestions.
- Undo is clean: `removeCSS` with the identical string. Keep the exact CSS string for each applied operation in the per-tab undo stack.
- **SPIKE:** confirm whether USER-origin injected sheets reach into open or closed shadow trees in current Chrome. Inherited properties (font-size, color, line-height) inherit into shadow trees regardless. For component internals, use `chrome.dom.openOrClosedShadowRoot` (§2.11) plus a scoped `adoptedStyleSheets` entry that you remove on undo.
- Registered content-script `css` files (D3) are injected before DOM construction. Their origin is not documented (**UNVERIFIED**, probably author), so give them high specificity and `!important` for overrides.

### 2.7 `externally_connectable` (web app → extension messaging)
```json
"externally_connectable": { "matches": ["https://app.webable.example/*", "http://localhost/*"] }
```
- If `matches` is omitted, no web page can connect. Patterns "cannot include wildcard domains nor subdomains of (effective) top level domains", so `<all_urls>`, `*://*/*` and `*://*.com/*` are rejected. `http://localhost/*` matches any localhost port.
- If you declare the key without `"ids"`, **other extensions can no longer connect**, which is a security plus.
- The page must know the extension ID: `chrome.runtime.sendMessage(EXT_ID, msg)`. `chrome.runtime` only exists on pages that match some installed extension's `externally_connectable`, which is also how the web app detects that the extension is installed.
- Extensions cannot message *to* web pages. The extension receives messages through `runtime.onMessageExternal`/`onConnectExternal`. Validate `sender.origin` (and `sender.url`) against the allowlist.
- Async responses: `return true` plus `sendResponse` works in every version. Returning a Promise from `onMessage` listeners works natively from **Chrome 148**.
- Sources: https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable ; https://developer.chrome.com/docs/extensions/mv2/manifest/externally-connectable (for the pattern-restriction text) ; https://developer.chrome.com/docs/extensions/develop/concepts/messaging

### 2.8 Side panel vs popup
- `sidePanel` has been available since Chrome 114. Other milestones:
  - `setPanelBehavior({ openPanelOnActionClick: true })`
  - `sidePanel.open()` requires a user gesture (116+)
  - per-tab `setOptions({ tabId, path, enabled })`
  - `getLayout()` for left/right position (140+)
  - `close()` (141+)
  - `onOpened` (141+) and `onClosed` (142+)
- Recommendation: make the **side panel the primary UI** for inspect, undo, "why this change" and settings. It stays open while the user interacts with the page and survives navigation. A popup closes on focus loss, which is hostile to fine-motor users and to a transparent undo flow. Use `onOpened`/`onClosed` to show a "panel open" state. A tiny popup is optional for a global on/off toggle.
- `action.openPopup()` is generally available from Chrome 127 (between 118 and 126 it was limited to policy-installed extensions).
- Onboarding: `action.getUserSettings().isOnToolbar` (91+) and `onUserSettingsChanged` (130+) let you nudge users to pin the icon. Chrome 153 Canary is experimenting with default pinning.
- Source: https://developer.chrome.com/docs/extensions/reference/api/sidePanel ; https://developer.chrome.com/docs/extensions/reference/api/action

### 2.9 Per-tab action badge and icon states
- `setBadgeText`, `setBadgeBackgroundColor`, `setBadgeTextColor` (110+), `setIcon`, `setTitle`, `setPopup` and `enable`/`disable` all accept `tabId`. Tab-scoped state "automatically resets when the tab is closed".
- Recompute on each navigation (`tabs.onUpdated` with `status:'loading'`, which needs no `tabs` permission for `tabId`/`status`).
- Always pair the badge with `setTitle`, for example "WebAble: 3 adjustments on this page", because badge text alone is not a good accessible name.
- Suggested states: off/not-granted (grey icon), active with N ops (badge count), paused on this site, verifier rolled back (warning glyph plus title).

### 2.10 CSP for extension pages
- MV3 default: `script-src 'self'; object-src 'self';`. The minimum allowed policy is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self';`. You cannot add remote script sources or `'unsafe-eval'`, and WASM needs `'wasm-unsafe-eval'`. Sandboxed pages get a looser policy.
- React and Motion are fine. Avoid libraries that `eval`. Tailwind v4 compiles at build time, which is fine.
- Source: https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy

### 2.11 Fonts and shadow roots
- Bundle `.woff2` files in the extension (no Google Fonts CDN, for privacy and CSP) and check the license (OFL fonts such as Atkinson Hyperlegible are fine).
- For the page to load them via CSS, they must be `web_accessible_resources`. WAR allows **fingerprinting** ("By default no resources are web accessible, as this allows a malicious website to fingerprint extensions"). Mitigate with `"use_dynamic_url": true`, where the ID regenerates per session. WXT itself applies this to UI CSS.
- `@font-face` inside a shadow root **does not apply**, so register the face at document level with an injected USER stylesheet or `document.fonts.add(new FontFace(...))`.
- `chrome.dom.openOrClosedShadowRoot(element)` (Chrome 88+) returns open **or closed** shadow roots, or null. Use it only for read-only feature extraction and for scoped style application. **Never** use it to alter ARIA or focus behavior (invariant).
- Sources: https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources ; https://developer.chrome.com/docs/extensions/reference/api/dom

### 2.12 Other platform changes that matter
- **Chrome 148 (May 2026):** all APIs are available under `browser.*`, `runtime.onMessage` listeners can return Promises, and structured-clone messaging is opt-in.
- **Chrome 149:** `userScripts.execute` validates synchronously. Not needed here.
- **Chrome 153:** `browser.publicSuffix` API. It is useful for per-site settings keyed on registrable domain without storing URLs.
- Recommended `minimum_chrome_version: "148"`. Chrome auto-updates, and 148 is about 8 majors old on the 2-week cadence.
- Network: extension SW and pages bypass CORS for hosts they hold permission for. **Content scripts are always subject to the page's CORS**, and the docs recommend routing fetches through the SW with a narrow message schema, never "fetch arbitrary URL". Before host access is granted, SW requests to Supabase carry `Origin: chrome-extension://<id>` and are CORS-checked.
- Source: https://developer.chrome.com/docs/extensions/whats-new ; https://developer.chrome.com/docs/extensions/develop/concepts/network-requests ; https://developer.chrome.com/docs/extensions/develop/concepts/browser-namespace

### 2.13 Chrome built-in Prompt API (Gemini Nano)
- Status: **stable in extensions since Chrome 138** and on the web since Chrome 148. Drop the old `aiLanguageModelOriginTrial` permission. The Summarizer, Translator and Language Detector APIs are stable from 138. Writer and Rewriter are in developer trial, Proofreader in origin trial.
- API: `LanguageModel.availability()` and `LanguageModel.create()`. The download requires **user activation** and exposes a `downloadprogress` monitor. `expectedInputs`/`expectedOutputs` and `responseConstraint` (JSON Schema structured output) are available. Extensions keep `topK`/`temperature` and `LanguageModel.params()`.
- Requirements: desktop only (Windows 10/11, macOS 13+, Linux, Chromebook Plus); **≥22 GB free** on the profile volume; GPU with **>4 GB VRAM**, or CPU with 16 GB RAM and 4+ cores. Languages: en, ja, es, de, fr. **Not available in Web Workers**. Extension-SW availability is undocumented (**SPIKE**), so plan to call it from the side panel or an offscreen document.
- Verdict: use it only as an **optional on-device enhancement or privacy mode**, never as the primary decision layer. Many target users' machines will not qualify, and the model download would violate "value on first visit". The server path stays primary. Its outputs are data validated by the same Zod schema.
- Sources: https://developer.chrome.com/docs/extensions/ai/prompt-api ; https://developer.chrome.com/docs/ai/built-in-apis

### 2.14 Testing the extension
- Playwright (1.63): `chromium.launchPersistentContext('', { channel: 'chromium', args: ['--disable-extensions-except=<dir>', '--load-extension=<dir>'] })`. Get the ID from `context.serviceWorkers()[0].url().split('/')[2]`.
- "Google Chrome and Microsoft Edge removed the command-line flags needed to side-load extensions", so use Playwright's bundled Chromium. The `chromium` channel also runs extensions headless. (https://playwright.dev/docs/chrome-extensions)
- Optional host permissions cannot be granted by clicking the prompt in CI. **SPIKE:** use a test-only build flavor that moves `<all_urls>` to `host_permissions` (behind a build flag, and asserted absent in the production manifest).

---

## 3. Supabase

### 3.1 Keys and signing (the state as of Sept 2026)
- **API keys:** use `sb_publishable_…` (replaces `anon`) and `sb_secret_…` (replaces `service_role`).
  - "The legacy `anon` and `service_role` keys keep working **until the end of 2026**", so a new build should start on the new keys.
  - New keys are **not JWTs**. Send them in the `apikey` header, never as `Authorization: Bearer`.
  - Secret keys return 401 when used from a browser (matched on User-Agent).
  - Edge Functions get the env vars `SUPABASE_PUBLISHABLE_KEYS` and `SUPABASE_SECRET_KEYS` (JSON objects keyed by name, e.g. `['default']`), and `@supabase/server` also reads `SUPABASE_JWKS`.
  - Source: https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- **JWT signing keys:** pick **ES256 (P-256)** as recommended. RS256 is supported, EdDSA is "coming soon", and HS256 is "not recommended for production".
  - JWKS lives at `https://<ref>.supabase.co/auth/v1/.well-known/jwks.json`. It is cached 10 min at the Supabase edge, plus up to 10 min in client libraries.
  - "Supabase products do not rely on this cache", so revocation is instant for RLS-only paths. Your own verifiers see revocation 20+ min late.
  - Rotation signs no one out. The docs say to wait at least 20 min after creating a standby key before rotating when you verify JWTs yourself.
  - Source: https://supabase.com/docs/guides/auth/signing-keys ; https://supabase.com/docs/guides/auth/jwts
- **`auth.getClaims()`** verifies against JWKS locally (cached) when the project uses asymmetric keys. With HS256 it always calls the Auth server. Prefer it over `getUser()` for request authorization. (https://supabase.com/docs/reference/javascript/auth-getclaims)
- **Edge Function `verify_jwt`:**
  - The platform check validates both legacy HS256 **and** asymmetric-key JWTs, but it rejects API keys.
  - Keep it **on** for user-only functions called with a session (defense in depth).
  - Turn it **off** only for webhook, secret-key or `auth:'none'` functions.
  - The migration guide adds a caveat: functions called with the new API keys *and no user JWT* need `verify_jwt = false` plus in-code authorization.
  - Source: https://supabase.com/docs/guides/functions/auth-headers

### 3.2 Authenticating the extension against the same project: options

| Option | UX for target users | Security | Verdict |
|---|---|---|---|
| **(1) Handoff of the web app's refresh token** over `externally_connectable` | Seamless | **Bad.** Both clients hold one session family. Refresh tokens are single-use; reuse outside the 10 s interval or outside the "parent-of-active" allowance "terminat[es] the whole session". Web `signOut()` defaults to `scope:'global'` (verified in auth-js source). A copied long-lived credential also crosses a trust boundary. | **Reject** |
| **(2) One-time `token_hash` handoff** (server `admin.generateLink` → extension `verifyOtp`) | Seamless: the user finishes onboarding in the web app and the extension signs itself in. Nothing to type. | The extension gets its **own session** with its own refresh-token family. The credential that crosses the boundary is single-use and expiring (mailer OTP expiry, default 1 h). The server binds it to the verified caller. Only allowlisted origins can message the extension. | **Recommended** |
| **(3) `chrome.identity.launchWebAuthFlow`** to the web app's `/extension/connect` page (redirect `https://<ext-id>.chromiumapp.org/…`), which returns the `token_hash` in the redirect | Good (auth popup, uses the profile's cookies) | Same as (2), plus a `state` nonce. `identity` has no install warning. | **Fallback** when the user starts from the extension without the web app open |
| **(4) OAuth 2.1 Server** (Supabase as IdP; extension is a public PKCE client at `/auth/v1/oauth/authorize` and `/oauth/token`) | Good | Standards-based. Tokens are Supabase JWTs with a `client_id` claim that RLS can use. Public beta since 2025-11-26. The consent screen is hosted by your app. Whether a `chromiumapp.org` redirect URI is accepted is undocumented. | Promising, but beta. Revisit for v2. |
| **(5) Email OTP typed into the extension** | Poor for reduced fine-motor precision (6-digit entry) | Fine | Accessibility fallback only |
| Passkeys (`signInWithPasskey`, supabase-js ≥2.105) | Excellent for motor users | "experimental … API may change". The RP ID must match the origin, so it works in the **web app**, not in extension origins. | Offer in the web app later |

Sources: https://supabase.com/docs/guides/auth/sessions ; https://supabase.com/docs/guides/auth/oauth-server/oauth-flows ; https://supabase.com/docs/guides/auth/passkeys ; https://developer.chrome.com/docs/extensions/reference/api/identity ; auth-js 2.117.2 (`GoTrueClient.js` line 3414: `signOut(options = { scope: 'global' })`; `GenerateLinkProperties` has `action_link`, `email_otp`, `hashed_token`, `redirect_to`, `verification_type`).

### 3.3 Code: the recommended auth handoff

**Web app, Next 16 route handler** (`app/api/extension/handoff/route.ts`):
```ts
import { NextResponse, type NextRequest } from 'next/server';
import { createClient as createServerSupabase } from '@/lib/supabase/server'; // @supabase/ssr server client (§3.7)
import { createClient } from '@supabase/supabase-js';

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN!; // e.g. https://app.webable.example

export async function POST(req: NextRequest) {
  // CSRF: only our own pages may request a handoff (route handlers have no built-in origin check)
  if (req.headers.get('origin') !== APP_ORIGIN) return new NextResponse(null, { status: 403 });

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getClaims();          // verified locally via JWKS
  const sub = data?.claims?.sub; const email = data?.claims?.email as string | undefined;
  if (error || !sub || !email) return new NextResponse(null, { status: 401 });

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // generateLink does NOT send an email; it returns link + hashed_token (single-use, expires per mailer OTP expiry)
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  if (linkErr || !link?.properties?.hashed_token || link.user?.id !== sub)
    return new NextResponse(null, { status: 500 });

  return NextResponse.json(
    { tokenHash: link.properties.hashed_token, type: link.properties.verification_type },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
// Add per-user rate limiting (e.g. 5/min) and audit-log the event (user id + timestamp only).
```

**Web app, client component** (after onboarding, or on the "Connect extension" button):
```ts
'use client';
const EXT_ID = process.env.NEXT_PUBLIC_WEBABLE_EXTENSION_ID!;

export function isExtensionInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    const rt = (globalThis as any).chrome?.runtime;
    if (!rt?.sendMessage) return resolve(false); // chrome.runtime only exists if some extension lists this origin
    rt.sendMessage(EXT_ID, { type: 'webable/ping' }, (res: unknown) =>
      resolve(!rt.lastError && (res as any)?.ok === true));
  });
}

export async function connectExtension(): Promise<'connected' | 'not-installed' | 'failed'> {
  if (!(await isExtensionInstalled())) return 'not-installed';
  const r = await fetch('/api/extension/handoff', { method: 'POST', credentials: 'same-origin' });
  if (!r.ok) return 'failed';
  const { tokenHash, type } = await r.json();
  return new Promise((resolve) => {
    (globalThis as any).chrome.runtime.sendMessage(
      EXT_ID, { type: 'webable/session-handoff', tokenHash, otpType: type },
      (res: any) => resolve(!(globalThis as any).chrome.runtime.lastError && res?.ok ? 'connected' : 'failed'));
  });
}
```

**Extension, service worker** (the only auth client):
```ts
// lib/supabase.sw.ts: imported ONLY by entrypoints/background.ts
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@webable/db-types'; // from `supabase gen types`

const chromeStorage = {
  getItem: async (k: string) => ((await browser.storage.local.get(k))[k] as string | undefined) ?? null,
  setItem: async (k: string, v: string) => { await browser.storage.local.set({ [k]: v }); },
  removeItem: async (k: string) => { await browser.storage.local.remove(k); },
};

export const supabase = createClient<Database>(import.meta.env.WXT_SUPABASE_URL, import.meta.env.WXT_SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: chromeStorage,
    storageKey: 'webable.auth',
    persistSession: true,
    autoRefreshToken: false,   // SW can't keep a 30 s ticker alive; getSession() refreshes on demand (90 s margin)
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
});

export async function freshAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession(); // refreshes if within EXPIRY_MARGIN
  return data.session?.access_token ?? null;
}

// entrypoints/background.ts
const ALLOWED_ORIGINS = new Set([import.meta.env.WXT_APP_ORIGIN]); // plus http://localhost:3000 in dev builds only

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() =>
    browser.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })); // hide tokens from content scripts

  browser.runtime.onMessageExternal.addListener((msg: any, sender, sendResponse) => {
    if (!sender.origin || !ALLOWED_ORIGINS.has(sender.origin)) return;      // drop everything else
    if (msg?.type === 'webable/ping') { sendResponse({ ok: true }); return; }
    if (msg?.type === 'webable/session-handoff' && typeof msg.tokenHash === 'string') {
      (async () => {
        const { data, error } = await supabase.auth.verifyOtp({
          token_hash: msg.tokenHash, type: msg.otpType === 'magiclink' ? 'magiclink' : 'email',
        });
        if (error || !data.session) return sendResponse({ ok: false });
        await onSignedIn(data.session.user.id); // pull profile, show "Signed in as …, not you?" in side panel
        sendResponse({ ok: true });
      })();
      return true; // keep channel open (works on all versions; Chrome 148+ could return the promise)
    }
  });

  // UI contexts ask the SW for a short-lived ACCESS token only; the refresh token never leaves the SW
  browser.runtime.onMessage.addListener((msg: any, sender, sendResponse) => {
    if (msg?.type !== 'webable/access-token') return;
    if (sender.id !== browser.runtime.id || sender.tab) return; // extension pages only, never content scripts
    freshAccessToken().then((t) => sendResponse({ token: t }));
    return true;
  });
});
```

**Extension side panel and popup** (data access without a second auth client):
```ts
export const supabaseUi = createClient<Database>(URL, PUBLISHABLE_KEY, {
  accessToken: async () => (await browser.runtime.sendMessage({ type: 'webable/access-token' }))?.token ?? null,
}); // with accessToken set, supabaseUi.auth.* is disabled by design, so sign-in/out goes through SW messages
```

Web app sign-out: call `supabase.auth.signOut({ scope: 'local' })`. Offer "Sign out everywhere (including the extension)" as the explicit `global` option. The extension's own sign-out calls `signOut({ scope: 'local' })` in the SW.

### 3.4 Security notes on handoff and refresh
- supabase-js ≥2.107 is **lockless**. Cross-tab refresh races are resolved server-side ("parent-of-active": a concurrent refresh with the parent of the active token receives the active token). Two independent holders of one family that drift more than one rotation apart trigger reuse detection and revoke the family. That is the concrete failure mode of option (1).
- One auth client (the SW) means within-process single-flight dedup (`refreshingDeferred`) covers every refresh. The side panel and popup never refresh.
- The `token_hash` is single-use and expiring. Transmit it only in the `sendMessage` payload, never in a URL visible to history. With option (3) it appears in the `chromiumapp.org` redirect URL, which is intercepted by `launchWebAuthFlow` and not navigated.
- `storage.local` is not encrypted. That is acceptable on the threat model of a user's own profile, but restrict it to trusted contexts and never log tokens.
- Consider Auth settings "inactivity timeout" and "time-boxed sessions" (Pro plan) for shared computers.
- Sources: https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/migrations/lockless-coordination.md ; https://supabase.com/docs/guides/auth/sessions

### 3.5 Edge Function: JWT verification, AI proxy, per-user rate limit, CORS

Recommended pattern: `@supabase/server` handles verification (it uses `jose` against JWKS). CORS is manual here because the allowlist includes `chrome-extension://` origins. `withSupabase`'s `cors` option only takes static headers, and `'default'` means `Access-Control-Allow-Origin: *`.

```ts
// supabase/functions/decide/index.ts  (config.toml: [functions.decide] verify_jwt = true)
import { createSupabaseContext, fromSupabaseUrl } from 'npm:@supabase/server@1.8.1';
import { z } from 'npm:zod@4.6.5';
import { PageFeatures, Decision } from '../_shared/schemas.ts'; // same Zod schemas shipped in the extension bundle

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const ALLOWED = new Set((Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').filter(Boolean));
// e.g. "chrome-extension://<prod-id>,chrome-extension://<dev-id>,https://app.webable.example"

const cors = (origin: string | null): Record<string, string> => ({
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-retry-count',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
  ...(origin && ALLOWED.has(origin) ? { 'Access-Control-Allow-Origin': origin } : {}),
});
// Note: the extension SW skips CORS entirely once it holds host permission; the allowlist covers the web app and
// the pre-grant window. Since auth is a bearer token (no cookies), '*' would not be a CSRF hole; the allowlist is defense-in-depth.

const Body = z.strictObject({ features: PageFeatures, profileVersion: z.int().nonnegative() });

export default {
  async fetch(req: Request): Promise<Response> {
    const origin = req.headers.get('origin');
    const h = cors(origin);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: h });
    if (req.method !== 'POST') return new Response(null, { status: 405, headers: h });

    // 1) Verify the user JWT (signature via JWKS, plus iss/aud)
    const { data: ctx, error } = await createSupabaseContext(req, {
      auth: 'user', issuer: fromSupabaseUrl(SUPABASE_URL), audience: 'authenticated',
    });
    if (error) return Response.json({ code: error.code }, { status: error.status, headers: h });
    const userId = ctx.userClaims!.id;

    // 2) Bounded input (reject oversized or unknown fields; never log features)
    const len = Number(req.headers.get('content-length') ?? '0');
    if (len > 32_768) return new Response(null, { status: 413, headers: h });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return Response.json({ code: 'BAD_INPUT' }, { status: 400, headers: h });

    // 3) Per-user rate limit (atomic, Postgres; see SQL below)
    const { data: allowed, error: rlErr } = await ctx.supabaseAdmin.rpc('consume_ai_quota',
      { p_user: userId, p_limit: 60, p_window_seconds: 60 });
    if (rlErr) return Response.json({ code: 'RL_ERROR' }, { status: 503, headers: h });
    if (!allowed) return Response.json({ code: 'RATE_LIMITED' }, { status: 429, headers: { ...h, 'Retry-After': '60' } });

    // 4) Profile via the user-scoped client (RLS applies)
    const { data: profile } = await ctx.supabase.from('functional_profiles')
      .select('version, dimensions').eq('user_id', userId).single();

    // 5) Model call with hard timeout + structured output; model returns DATA only
    const upstream = await fetch(Deno.env.get('AI_API_URL')!, {
      method: 'POST',
      signal: AbortSignal.timeout(8_000),            // well under the 30 s SW fetch kill and 150 s function limit
      headers: { 'content-type': 'application/json', authorization: `Bearer ${Deno.env.get('AI_API_KEY')}` },
      body: JSON.stringify(buildPrompt(profile, parsed.data.features, z.toJSONSchema(Decision))),
    }).catch(() => null);
    if (!upstream?.ok) return Response.json({ ops: [], degraded: true }, { headers: h });

    // 6) Validate model output against the reviewed operation library; drop anything invalid
    const decision = Decision.safeParse(extractJson(await upstream.json()));
    return Response.json(decision.success ? decision.data : { ops: [], degraded: true }, { headers: h });
  },
};
```

**Alternative: verify manually without `@supabase/server`** (for example in a Next route handler):
```ts
import { createRemoteJWKSet, jwtVerify } from 'jose'; // 6.2.x
const JWKS = createRemoteJWKSet(new URL(`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`)); // module scope = cached per isolate
export async function verifySupabaseJwt(authz: string | null) {
  const token = authz?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new Error('missing bearer');
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: `${SUPABASE_URL}/auth/v1`, audience: 'authenticated', algorithms: ['ES256'],
  });
  return payload; // payload.sub = user id; use app_metadata (never user_metadata) for authorization
}
```

**Rate-limit SQL** (a table in a non-exposed schema; the function is callable only by `service_role`):
```sql
create schema if not exists private;
create table private.ai_quota (
  user_id uuid not null, window_start timestamptz not null, used int not null default 0,
  primary key (user_id, window_start)
);
alter table private.ai_quota enable row level security;       -- no policies: unreachable except by owner/service_role
grant usage on schema private to service_role;
grant select, insert, update on private.ai_quota to service_role;

create or replace function public.consume_ai_quota(p_user uuid, p_limit int, p_window_seconds int)
returns boolean language plpgsql security invoker set search_path = '' as $$
declare v_used int;
begin
  insert into private.ai_quota as q (user_id, window_start, used)
  values (p_user, to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds), 1)
  on conflict (user_id, window_start) do update set used = q.used + 1
  returning q.used into v_used;
  return v_used <= p_limit;
end $$;
revoke all on function public.consume_ai_quota(uuid,int,int) from public, anon, authenticated;
grant execute on function public.consume_ai_quota(uuid,int,int) to service_role;
-- Prune old windows with pg_cron daily. Add a second call with p_window_seconds=86400 for a daily cost cap.
```
The documented alternative is Upstash Redis (`@upstash/ratelimit` 2.2.0 over HTTP), which avoids a DB round trip (https://supabase.com/docs/guides/functions/examples/rate-limiting).

Edge Function limits: 256 MB memory, **2 s CPU** per request (async I/O excluded), 150 s wall clock on Free and 400 s on paid, 150 s response timeout (504), 20 MB bundle via the CLI (https://supabase.com/docs/guides/functions/limits). `corsHeaders` ships in `@supabase/supabase-js/cors` (≥2.95), and `withSupabase` handles CORS and preflight automatically (https://supabase.com/docs/guides/functions/cors).

Privacy: store **no** page features, URLs or prompts server-side. The only per-request persistence is the quota counter. Cache decisions client-side, keyed by feature hash.

### 3.6 RLS performance and safety (primary doc)
- Wrap `auth.uid()`/`auth.jwt()` and helper calls in `(select …)` so Postgres caches them per statement ("initPlan"): `using ((select auth.uid()) = user_id)`.
- **Index every column a policy filters on.** "A column counts as indexed only when it comes first in a btree index."
- Always add `to authenticated` (or the right role) to every policy.
- Add explicit filters in queries (`.eq('user_id', uid)`) as well as RLS, so the planner can use indexes.
- Put helpers in `private` as `security definer set search_path = ''`. "Never create one in a schema listed under Exposed schemas."
- Never authorize on `user_metadata`, because users can edit it. Use `app_metadata`.
- Minimize joins inside policies. Prefer `col in (select … )` against a security-definer helper.
- Run `get_advisors` (performance and security) in CI against the branch.
- Source: https://supabase.com/docs/guides/database/postgres/row-level-security

### 3.7 `@supabase/ssr` 0.12.7 with Next 16
The official template (`vercel/next.js` `examples/with-supabase`) uses:
- `proxy.ts` exporting `proxy(request)` that calls `updateSession`.
- `lib/supabase/server.ts`: `createServerClient` with `await cookies()`, `getAll`/`setAll`, and `try/catch` in `setAll` for Server Components.
- `lib/supabase/client.ts`: `createBrowserClient`.
- The env vars are **`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`**.

Key rules from the template and docs:
- "Do not run code between createServerClient and supabase.auth.getClaims()."
- You "*must* return the supabaseResponse object as it is". Copy its cookies if you build a new response.
- "Never trust `supabase.auth.getSession()` inside server code such as Proxy."
- Use `getClaims()` to protect pages.
- Don't put the client in a module-level global (Fluid compute). Create one per request.
- Also verify auth inside every Server Action and route handler. The Next docs warn that matcher changes can silently remove Proxy coverage.

Sources: https://supabase.com/docs/guides/auth/server-side/nextjs ; https://github.com/vercel/next.js/tree/canary/examples/with-supabase

### 3.8 CLI migrations and type generation (CLI 2.118.0)
- Migration commands:
  - `supabase migration new <name>` creates a timestamped SQL file in `supabase/migrations`.
  - `supabase link --project-ref <ref>` links the project.
  - `supabase db push [--dry-run] [--include-seed] [--include-roles] [--linked | --db-url <url>]` applies migrations.
  - `supabase migration list` and `supabase migration repair` manage history.
- **Needs Docker:** `supabase start`, `db reset`, `db diff` (shadow DB built from migrations; engines migra, pg-delta, pgadmin), and `test db --local`.
- **No Docker needed:** `supabase gen types typescript --project-id <ref>` (or `--linked` / `--db-url`) `--schema public > packages/db-types/database.types.ts`, and `db push --db-url`.
- `supabase test db --db-url/--linked` exists. It connected directly in my probe. The help says it "Runs `pg_prove` in a container", so assume Docker is still needed for pg_prove (**UNVERIFIED**).
- CI:
  1. Lint SQL.
  2. Run PGlite unit tests (§3.9).
  3. `db push --db-url $BRANCH_DB_URL`.
  4. Run integration tests against the branch.
  5. Run `gen types` and fail on diff.
  6. Promote.
- Branching: branches can be created from the dashboard or CLI without GitHub (the dashboard flow is beta). There are **persistent** (staging/dev) and **preview** (ephemeral) branches. Branches start **without production data**.
- Sources: CLI `--help` output (2.118.0) ; https://supabase.com/docs/guides/local-development/database-migrations ; https://supabase.com/docs/guides/deployment/branching

### 3.9 Testing migrations and RLS without Docker: verified locally
I ran this in the scratchpad with `@electric-sql/pglite@0.5.8`, `@electric-sql/pglite-pgtap@0.0.9` and the `pgcrypto` contrib, on Postgres 18.3 wasm. Output: `1..3 / ok 1 - user A sees only own row / ok 2 - cannot insert for user B / ok 3 - Table public.profiles should have the correct policies`.

Harness pattern:
```ts
import { PGlite } from '@electric-sql/pglite';
import { pgtap } from '@electric-sql/pglite-pgtap';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
const db = await PGlite.create({ extensions: { pgtap, pgcrypto } });
await db.exec(SUPABASE_SHIM);           // roles anon/authenticated/service_role(bypassrls); schema auth; auth.users;
                                        // auth.uid()/auth.jwt() reading current_setting('request.jwt.claims', true)
for (const f of migrationFiles) await db.exec(readFileSync(f, 'utf8'));   // supabase/migrations/*.sql in order
await db.exec(`create extension pgtap;`);
const res = await db.exec(`begin; select plan(2);
  set local role authenticated;
  select set_config('request.jwt.claims','{"sub":"<uuid>","role":"authenticated"}', true);
  select is((select count(*)::int from public.profiles), 1, 'own rows only');
  select throws_ok($$insert into public.profiles(user_id) values ('<other>')$$, '42501', null, 'no cross-user insert');
  select * from finish(); rollback;`);   // use exec (multi-statement), not query
```
- Caveats:
  - PGlite runs **PG 18** while Supabase hosts **PG 17**.
  - The Supabase-managed schemas and extensions (`pg_net`, `supabase_vault`, `pg_graphql`, `pg_cron`, `storage`, and the real `auth` internals) are absent. Guard or shim them.
  - Treat the hosted branch run as the source of truth for integration.
  - Other PGlite extensions available: `uuid_ossp`, `pg_trgm`, `citext` (contrib), and `@electric-sql/pglite-pgvector`.
- **pg-mem** (3.0.14) has no RLS and only "kind of" plpgsql support, so reject it for this purpose.
- Sources: https://pglite.dev/extensions/ ; local run.

---

## 4. Web toolchain: breaking notes

### 4.1 Next.js 16 (current: 16.3.6, released 2026-09-22; 16.3 released 2026-08-03)
- Yes, **16 is current**. 16.4 is in canary, and the 15.x line only gets backports (15.5.26).
- **`proxy.ts` replaces `middleware.ts`.** The middleware convention "is deprecated" but still works. Proxy runs on **Node.js only**, and setting `runtime` throws; keep `middleware` only if you need edge. Rename the export to `proxy`. The `skipMiddlewareUrlNormalize` option is now `skipProxyUrlNormalize`. Codemod: `npx @next/codemod@canary middleware-to-proxy .`
- **`cacheComponents: true`** (top level) replaces `experimental.ppr/dynamicIO/useCache`. Enabling it "can surface build errors for uncached data outside of `<Suspense>`". `cacheLife`/`cacheTag` are stable. 16.3 adds opt-in `partialPrefetching: true`, and "Instant Navigations" behaviors "will become the default in a future major".
  - Recommendation: turn on `cacheComponents` from day one on this greenfield app. Marketing pages prerender, and authenticated routes read `cookies()` inside Suspense. It avoids a forced migration later. If the team can't commit to the Suspense model, leave it off (it is opt-in).
- Other breaking or new items:
  - Sync `params`/`searchParams`/`cookies()`/`headers()` access has been removed.
  - `revalidateTag(tag, profile)` needs two arguments. `updateTag` and `refresh` are new (Server Actions).
  - Turbopack is the default for dev and build, and a custom webpack config makes the build fail.
  - `next lint` has been removed (use the ESLint CLI with flat config).
  - AMP and `serverRuntimeConfig`/`publicRuntimeConfig` have been removed.
  - Every parallel-route slot needs `default.js`.
  - `next/image` defaults changed: `qualities: [75]`, `minimumCacheTTL` of 4 h, 16 removed from `imageSizes`, local-IP blocking, and at most 3 redirects.
  - `next dev` writes to `.next/dev`.
  - React Compiler support is stable (`reactCompiler: true`, not on by default). 16.3 has an experimental Rust compiler (`experimental.turbopackRustReactCompiler`).
  - Node ≥20.9, TS ≥5.1, browsers Chrome/Edge/Firefox 111+ and Safari 16.4+.
- New in 16.3:
  - `catchError` error boundaries (`next/error`)
  - `next/root-params`
  - `import.meta.glob`
  - `@next/playwright` `instant()` helper
  - TypeScript 7 for `next build` type-checking
  - `next dev` maintains an `AGENTS.md` block that points to bundled version-matched docs in `node_modules/next/dist/docs/`
- Sources: https://nextjs.org/docs/app/guides/upgrading/version-16 ; https://nextjs.org/docs/app/api-reference/file-conventions/proxy ; https://nextjs.org/blog/next-16-3

### 4.2 TypeScript 7.0 (released 2026-07-08)
- Native Go port, about 8–12× faster builds. `tsc` is 7.
- **No stable programmatic API yet**, so typescript-eslint (whose peer range is `<6.1.0`), ts-node, and API-based Vite plugins need TS 6. Microsoft's recommended `package.json`:
  ```json
  { "devDependencies": { "@typescript/native": "npm:typescript@^7.0.2", "typescript": "npm:@typescript/typescript6@^6.0.2" } }
  ```
  The binaries are `tsc` (TS 7 through `@typescript/native`) and `tsc6`.
- WXT 0.21 does not import the TS API (I grepped the dist), and neither does Next 16.3 for its opt-in TS 7 check.
- TS 7 removes these options: `target: es5`, `moduleResolution: node/node10/classic`, AMD/UMD/System modules, and `baseUrl` (use `paths`). `esModuleInterop` can no longer be set to false.
- New defaults: `strict: true`, `module: esnext`, `types: []` (so list `"types"` explicitly, e.g. `["chrome"]` is not needed with WXT's generated types).
- Source: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/

### 4.3 Other libraries
- **React 19.3** (2026-09-09): stable `<ViewTransition>` and Fragment refs (`focus`, `observeUsing`, `getClientRects`…), plus `browser()`, `addTransitionType`, Trusted Types, and Server Components rendering Context directly. No breaking changes are listed.
  - Fragment refs help calibration tasks, which need measurement without wrapper divs.
  - Honor `prefers-reduced-motion` in every ViewTransition. https://react.dev/blog/2026/09/09/react-19-3
- **Zod 4.6.5**:
  - Use `z.strictObject` for all wire schemas (AI output, page features).
  - `z.toJSONSchema()` produces the model's structured-output schema, so there is one source of truth.
  - `error` replaces `message`, `invalid_type_error` and `required_error`.
  - `z.email()`/`z.uuid()` are top-level, `.merge` is replaced by `.extend`, and `z.function()` is no longer a schema.
  - https://zod.dev/v4/changelog
- **Vite 8** (2026-03-12): Rolldown and Oxc, Node 20.19+ or 22.12+, "many projects will work without any config changes". https://vite.dev/blog/announcing-vite8
- **Vitest 5** (2026-09-03): see the table in §1 (Vite ≥6.4, Node ≥22.12, `clearMocks` default, top-level `vi.mock` only, awaited async assertions, `.vitest/` artifacts, 1-based pool IDs). https://vitest.dev/guide/migration.html
- **Motion 13** (2026-08-05): import from `motion/react`. The only breaking change is `@emotion/is-prop-valid` moving to explicit injection. Honor reduced motion with `MotionConfig reducedMotion="user"`. https://motion.dev/docs/react-upgrade-guide
- **React Aria Components 1.21.1**: the accessible primitive layer for the web app and side panel. React 19 is supported.
- **Playwright 1.63**:
  - Test locks and `locator.visible()`.
  - ARIA snapshots in traces, which are useful for asserting that WebAble **never changes the accessibility tree**. Take a before/after ARIA snapshot diff as a regression test for the invariant.
  - 1.61 added virtual WebAuthn authenticators, useful for testing passkeys later.
  - https://playwright.dev/docs/release-notes

### 4.4 Recommended pins (use exact versions plus a lockfile; Renovate for bumps)
```
node 24.21.x (engines ">=24 <25"; .nvmrc 24)
next 16.3.6 · react 19.3.0 · react-dom 19.3.0 · @types/react 19.3.0
@supabase/supabase-js 2.117.2 · @supabase/ssr 0.12.7 · @supabase/server 1.8.1 (Edge) · supabase (CLI) 2.118.0 · jose 6.2.12
wxt 0.21.4 · @wxt-dev/module-react 1.2.2 · vite 8.3.1 · @vitejs/plugin-react 6.1.1
typescript → npm:@typescript/typescript6@6.0.2 · @typescript/native → npm:typescript@7.0.2 · typescript-eslint 8.71.0 · eslint 10.11.0
zod 4.6.5 · react-aria-components 1.21.1 · motion 13.4.4 · tailwindcss 4.3.3 (+ @tailwindcss/vite 4.3.3)
@playwright/test 1.63.0 · vitest 5.0.2 · @electric-sql/pglite 0.5.8 · @electric-sql/pglite-pgtap 0.0.9
Chrome: minimum_chrome_version "148"
```

---

## 5. Open spikes (≤1 day each)
1. Whether a USER-origin `insertCSS` sheet applies inside shadow trees, and the origin of registered content-script `css` files.
2. Whether `registerContentScripts` registrations survive extension auto-update, or only reconciliation keeps them.
3. How to grant optional `<all_urls>` in Playwright CI (test build flavor vs `--enable-features` flags).
4. Whether `generateLink(magiclink)` → `verifyOtp` works for users who signed up with OAuth only, and how to set an appropriate OTP expiry (the global mailer setting).
5. Whether the Prompt API is available in an extension service worker, and its real on-device latency on a mid-range laptop.
6. Whether `supabase test db --db-url` runs without Docker, and whether `@electric-sql/pglite-socket` can stand in as a `--db-url` target for `db push` dry runs.
7. Whether Supabase OAuth 2.1 Server accepts a `https://<id>.chromiumapp.org/` redirect URI (a possible v2 upgrade from the magic-link handoff).

## 6. Source index
- Chrome: scripting https://developer.chrome.com/docs/extensions/reference/api/scripting · permissions https://developer.chrome.com/docs/extensions/reference/api/permissions · permission warnings https://developer.chrome.com/docs/extensions/develop/concepts/permission-warnings · permissions list https://developer.chrome.com/docs/extensions/reference/permissions-list · declare permissions https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions · content scripts https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts · storage https://developer.chrome.com/docs/extensions/reference/api/storage · SW lifecycle https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle · externally_connectable https://developer.chrome.com/docs/extensions/reference/manifest/externally-connectable · messaging https://developer.chrome.com/docs/extensions/develop/concepts/messaging · sidePanel https://developer.chrome.com/docs/extensions/reference/api/sidePanel · action https://developer.chrome.com/docs/extensions/reference/api/action · CSP https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy · WAR https://developer.chrome.com/docs/extensions/reference/manifest/web-accessible-resources · dom https://developer.chrome.com/docs/extensions/reference/api/dom · identity https://developer.chrome.com/docs/extensions/reference/api/identity · network requests https://developer.chrome.com/docs/extensions/develop/concepts/network-requests · what's new https://developer.chrome.com/docs/extensions/whats-new · Prompt API https://developer.chrome.com/docs/extensions/ai/prompt-api · built-in AI https://developer.chrome.com/docs/ai/built-in-apis · CWS review https://developer.chrome.com/docs/webstore/review-process · CWS policies https://developer.chrome.com/docs/webstore/program-policies/policies · Limited Use https://developer.chrome.com/docs/webstore/program-policies/limited-use · 2-week cadence https://developer.chrome.com/blog/chrome-two-week-start · chromiumdash schedule API.
- Supabase: API key migration https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys · signing keys https://supabase.com/docs/guides/auth/signing-keys · JWTs https://supabase.com/docs/guides/auth/jwts · getClaims https://supabase.com/docs/reference/javascript/auth-getclaims · Edge auth headers https://supabase.com/docs/guides/functions/auth-headers · Securing functions https://supabase.com/docs/guides/functions/auth · CORS https://supabase.com/docs/guides/functions/cors · limits https://supabase.com/docs/guides/functions/limits · rate limiting https://supabase.com/docs/guides/functions/examples/rate-limiting · sessions https://supabase.com/docs/guides/auth/sessions · OAuth 2.1 server https://supabase.com/docs/guides/auth/oauth-server · passkeys https://supabase.com/docs/guides/auth/passkeys · redirect URLs https://supabase.com/docs/guides/auth/redirect-urls · generateLink https://supabase.com/docs/reference/javascript/auth-admin-generatelink · RLS https://supabase.com/docs/guides/database/postgres/row-level-security · SSR Next https://supabase.com/docs/guides/auth/server-side/nextjs · migrations https://supabase.com/docs/guides/local-development/database-migrations · branching https://supabase.com/docs/guides/deployment/branching · lockless coordination https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/migrations/lockless-coordination.md · @supabase/server https://github.com/supabase/server
- Toolchain: Next 16 upgrade https://nextjs.org/docs/app/guides/upgrading/version-16 · proxy https://nextjs.org/docs/app/api-reference/file-conventions/proxy · Next 16.3 https://nextjs.org/blog/next-16-3 · with-supabase example https://github.com/vercel/next.js/tree/canary/examples/with-supabase · React 19.3 https://react.dev/blog/2026/09/09/react-19-3 · TS 7 https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/ · Vite 8 https://vite.dev/blog/announcing-vite8 · Vitest migration https://vitest.dev/guide/migration.html · Zod 4 https://zod.dev/v4/changelog · Motion upgrade https://motion.dev/docs/react-upgrade-guide · WXT upgrading https://wxt.dev/guide/resources/upgrading.html · WXT content scripts https://wxt.dev/guide/essentials/content-scripts.html · Playwright extensions https://playwright.dev/docs/chrome-extensions · Playwright notes https://playwright.dev/docs/release-notes · PGlite extensions https://pglite.dev/extensions/
