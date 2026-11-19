# Presentation reliability pass — November 18, 2026

Built extension version: **0.1.2**. This pass follows the news/CSS sizing fixes in
[the earlier notes](news-engine-fix-2026-11-18.md). The website and restored
onboarding flow were preserved.

## Important defects fixed

| Defect reproduced | Result |
| --- | --- |
| A paragraph added after Calm view opened was absent | Small additions, edits and removals refresh the local outline without another AI request. Local layouts place new article text in the reading flow. |
| Refreshing a local layout remounted the reading surface | Stable component identity preserves the reading surface, open disclosures and form progress during content refreshes. |
| A source link promoted to the bottom action became a button without a destination | Primary navigation keeps its real `href`, target and browser modifier clicks; ordinary clicks still drive the source element. |
| Returning to a cached page after using a column reset manual 200% zoom to 100% | Cached-page returns synchronize with Chrome's current zoom instead of restoring an obsolete extension value. |
| Photos supplied as CSS backgrounds or video preview posters were absent | News cards recover those previews as still images while retaining the source destination. |
| Replacing an image left its disconnected node in the pairing cache | Cached pairs are invalidated when either the anchor or its paired media/heading disconnects. |
| A new article's metadata reused an old or empty image cache | The metadata cache checks the current URL and JSON-LD contents. |
| The floating launcher covered part of the primary action on a phone | The launcher sits above Calm view's action bar; measuring bar height avoids the slide-in animation's misleading position. |

## Verification

- 834 unit tests passed: engine 394, extension 375, server 65.
- Engine, extension and server TypeScript checks passed.
- Targeted lint has no errors; existing unused-symbol/config warnings remain.
- The production Chrome MV3 extension built successfully.
- The original news browser regression passed at 1440px and 390px: CSS sizing,
  hierarchy, no sideways scrolling, late text, source photos/links, Original page
  restoration, and manual 200% zoom surviving A+.
- The presentation browser regression checks 18 original article paragraphs and
  18 reference destinations at both widths, source photo visibility, added/edited/
  removed live text, a stable reading surface, mirrored source actions, normal
  navigation, client-side route changes, and launcher/action separation.
- The desktop case also checks an explicit column followed by manual 200% zoom
  and a persisted `pageshow` event, reproducing the cached-page handler's failure.
  This directly tests that handler; it does not claim Chrome used its real
  back/forward cache in the fixture run.
- A mixed-media news fixture retains all 12 story destinations and displays all
  12 photos, covering ordinary images, CSS backgrounds and video posters.
- A bounded live CNN check stayed at 100% browser zoom, retained 41 currently
  rendered links and displayed 23 loaded photos. Its screenshot is
  `output/presentation-hardening-2026-11-18/www.cnn.com-calm.png`.

Every browser check used a disposable Chrome profile with its extension API
origin pointed at an unused loopback port, AI layouts disabled, and no saved AI
reader. **No paid OpenAI calls were made by this verification.** No account or
database changes were needed. Paid rewrites and live AI layout responses were
not exercised; the server's local unit suite passed. Publisher counts describe
loaded content at that visit, not future or not-yet-loaded stories.

The default presentation suite is entirely local:

```sh
pnpm extension:build
pnpm engine:verify-news
pnpm engine:verify-presentation
```

Screenshots and machine-readable fixture results are in
`output/presentation-hardening-2026-11-18/`. Temporary Chrome profiles are removed
when each suite exits. The Gatorhack source manifest retains the original hashes
and separately records each intentional engine/UI adaptation.

## Before presenting on November 19

1. Run `pnpm dev` and `pnpm dev:server` in separate terminals for the website and
   AI engine server. The deterministic CSS/Calm improvements also work when the
   API server is unavailable.
2. Reload WebAble in `chrome://extensions`, confirm version **0.1.2**, and refresh
   the demonstration tabs. The unpacked folder is `apps/extension/.output/chrome-mv3`.
3. If Chrome remembers an excessive zoom from an older build, choose your preferred
   level once. WebAble now preserves native zoom.
4. Use the extension's saved fit or restored setup flow. The verification profiles
   never altered your browser's saved fit or account.

Existing native-fit cloud synchronization limitations described in
[the restore notes](gatorhack-restore.md) were not changed in this pass. Avoid
claiming that device-native setup automatically syncs to every account/device.
