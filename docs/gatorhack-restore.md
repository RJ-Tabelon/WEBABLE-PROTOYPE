# Gatorhack onboarding and engine restore

Source: `/Users/cadenshokat/Documents/Projects/webable-gatorhack`, branch
`study/mobile-sandbox`, commit `8f25bfeb0d07a45c3cb9d631ed5d07623603e098`.
This is the latest local checkout, including the later study branch's engine fixes.

The original extension onboarding, popup, engine, extraction, in-page panel, Lens,
Calm view, real-website tasks, contracts, assets, server and tests were copied.
The source's `packages/core` is `packages/engine` here and imports use
`@webable/engine`, because this website already has an unrelated `@webable/core`.
The initial restore retained the source behavior and removed the earlier port's
custom changes. The subsequent [news and sizing fixes](news-engine-fix-2026-11-18.md)
are intentional engine adaptations; onboarding still matches the source.

`/tune` now frames the extension's own `fitting.html`. There is one onboarding
implementation, with the original styles and Chrome APIs. The extension must be
installed to use it. It opens the real sites, returns to the website, and saves the
same native fit, evidence and AI reader profile as setup opened from the toolbar.
The unused website `TuneFlow` and its obsolete browser suite were removed.
Legacy pending-account saves at `/tune/save` remain available for existing data.

The restore's integration differences are:

- The existing fixed development extension id and website account bridge.
- A web-accessible `fitting.html`, restricted to the configured website origins.
- A ready notification from the framed entrypoint to its website parent.
- Skipping adaptation of the outer `/tune` host page itself.
- Renamed workspace imports and one corresponding server test fixture import.
- The server scripts read WebAble's root `.env`, rather than Gatorhack's environment.

The website's marketing pages and assets were preserved. Account storage still uses
the older website profile schema; native Gatorhack warm-ups save on this device,
as they do in the source project. This restore does not add cloud synchronization
for native fits, evidence or AI context, or change the website's privacy wording.

## Verification

`pnpm engine:check-source` checks 319 copied source files against frozen,
format-normalized SHA-256 hashes in `scripts/engine/gatorhack-source.json`.
The manifest retains the original hashes, records the integration exceptions above,
and separately records each intentional news/sizing adaptation with its reason and
current hash. It works without the sibling source checkout present.

`pnpm engine:verify`, with both dev servers running, loads the production extension
into a disposable Chrome profile. It exercises every onboarding stage, all three
Finding tabs and measured clicks, native persistence, result adjustments, settings,
AI setup, popup controls, page adaptation, Calm view and Original page. The Finding
pages use deterministic fixtures at the original task URLs. The engine uses the
original interactive Alderra demo on the running WebAble server.

Before replacement, affected working files were backed up to
`/tmp/webable-before-gatorhack-restore-20261118-162652/`. No user browser storage
was removed and no deployment was made.
