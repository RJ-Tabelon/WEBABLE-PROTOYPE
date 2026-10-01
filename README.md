# WebAble

WebAble is a local-first Chrome extension that reads the current page and will eventually apply verified, reversible accessibility transformations. Phase 1 deliberately has no backend, database, native app, or AI.

## What works now

- Click the WebAble toolbar icon on a normal website.
- WebAble temporarily reads the active tab using Chrome's `activeTab` permission.
- The popup shows the page title, a bounded text preview, structural counts, small-text findings, and basic layout measurements.
- A `MutationObserver` detects client-rendered changes and refreshes the analysis without collecting form values.
- Deterministic, opt-in rules provide a 16px text floor, published text-spacing minimums, enhanced keyboard focus, reduced motion, and high-contrast or dark-page modes.
- Enabled rules are reapplied to content inserted dynamically by React, Vue, or similar page frameworks.
- Form-field values are excluded, and the snapshot never leaves the browser.

## Development

Requirements: Node.js 22+ and pnpm 10.

```sh
pnpm install
pnpm dev:chrome
```

WXT opens a dedicated Chromium profile with the development extension loaded. Visit a website and click the WebAble toolbar icon.

To build WebAble and enable it in a normal Chrome profile:

```sh
pnpm extension:enable
```

See [TESTING.md](TESTING.md) for the complete development-browser, normal-Chrome, debugging, and manual smoke-test workflows.

## Verification

```sh
pnpm verify
```

The unit suite checks page extraction, privacy boundaries, and every deterministic rule. The Playwright suite loads the built extension in Chromium and verifies page reading, rule application, and dynamic-page updates end to end.

The unpacked production extension is written to `apps/extension/.output/chrome-mv3`.

## Repository layout

```text
apps/extension/     WXT Manifest V3 extension and React popup
apps/website/       Static landing page with a live demo (open index.html)
packages/shared/    Zod schemas and shared TypeScript types
docs/               Research and product decisions
```
