# Testing and enabling WebAble

WebAble has two browser workflows: a disposable development browser for daily coding and an unpacked production build for testing in a person's normal Chrome profile.

## Fast development browser

Run:

```sh
pnpm install
pnpm dev:chrome
```

WXT starts Chromium with WebAble already installed and watches the source files. Its dedicated profile is stored under `apps/extension/.wxt/chrome-data`, so test logins and browser settings survive restarts without modifying a developer's normal Chrome profile.

Open a normal webpage and select the WebAble toolbar icon. When testing a content-script or manifest change, refresh the webpage if the browser does not refresh it automatically.

## Enable in normal Chrome

On macOS, this command builds WebAble, opens its output folder, and opens Chrome's extension manager:

```sh
pnpm extension:enable
```

Then:

1. Turn on **Developer mode** in `chrome://extensions`.
2. Select **Load unpacked**.
3. Select `apps/extension/.output/chrome-mv3`.
4. Pin WebAble from Chrome's extensions menu.
5. Open a normal website and select WebAble.

On Windows or Linux the command makes the same best-effort attempt to open the folder and Chrome. If it cannot, run `pnpm extension:path` to print the exact directory and follow the five steps manually.

After rebuilding, use the reload button on WebAble's `chrome://extensions` card. Manifest, service-worker, and content-script changes require an extension reload; content-script changes also require refreshing the webpage.

## Test commands

| Command                                       | Purpose                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `pnpm test`                                   | Run fast unit tests for page analysis, privacy boundaries, and deterministic rules.                   |
| `pnpm --filter @webable/extension test:watch` | Rerun unit tests while editing.                                                                       |
| `pnpm check`                                  | Format check, lint, typecheck, unit test, production build, and inspect the production manifest.      |
| `pnpm test:e2e`                               | Load the built extension in Chromium and exercise reading, dynamic updates, and page transformations. |
| `pnpm verify`                                 | Run the complete local verification pipeline.                                                         |

Playwright needs its Chromium build once per machine:

```sh
pnpm --filter @webable/extension exec playwright install chromium
```

## Manual smoke test

Before sharing a build:

1. Open a normal article or documentation page.
2. Confirm WebAble reports the title, text, headings, links, and controls.
3. Enable the minimum-text and spacing rules and confirm the page remains usable.
4. Add or reveal dynamic content and confirm WebAble's revision count changes.
5. Check keyboard focus, reduced motion, high contrast, and dark mode separately.
6. Refresh the page and confirm WebAble does not run until the toolbar action grants access again.
7. Confirm Chrome lists only `activeTab` and `scripting` permissions for the production build.

The automated package check enforces the final permission requirement so an accidental broad host permission fails verification.
