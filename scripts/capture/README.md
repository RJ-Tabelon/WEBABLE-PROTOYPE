# Screenshot capture

Captures every WebAble surface, in every state the harness can reach, into one
folder with an `INDEX.md`. Built for design review rounds: run it again with a
new output folder and compare.

```sh
node scripts/capture/capture.mjs --out <folder>
# or
CAPTURE_OUT=<folder> node scripts/capture/capture.mjs
```

A full run builds the web app and the extension, then takes about 10 minutes.

## Options

| Option                   | Default          | What it does                                                |
| ------------------------ | ---------------- | ----------------------------------------------------------- |
| `--out <dir>`            | `$CAPTURE_OUT`   | Output folder (created). Required.                          |
| `--only <groups>`        | all              | Comma list: `site, auth, tune, app, extension, gallery`.    |
| `--skip-build`           | off              | Reuse `apps/web/.next-capture` and the e2e extension build. |
| `--skip-web-build`       | off              | Reuse `apps/web/.next-capture` only.                        |
| `--skip-extension-build` | off              | Reuse `apps/extension/.output/chrome-mv3-e2e` only.         |
| `--port <n>`             | 3200             | Web app port (`CAPTURE_WEB_PORT`).                          |
| `--stub-port <n>`        | 54390            | Local Supabase stand-in port.                               |
| `PW_CHANNEL=chromium`    | installed Chrome | Use Playwright's bundled Chromium.                          |

Only reuse a build when nothing changed since it was made: the default is a
fresh build every run.

## What it runs

- **Web app**: `next build` into `apps/web/.next-capture`, then `next start` on
  port 3200; stopped at the end. `apps/web/tsconfig.json` (which `next build`
  rewrites) is put back byte for byte.
- **Supabase**: a local stand-in (`lib/supabase-stub.mjs`) that the capture build
  points at through `NEXT_PUBLIC_SUPABASE_URL`. It serves the auth, REST, RPC and
  `extension-link` calls the app makes, with the e2e seed data (a measured fit
  and an earlier one, two weeks of activity, a learned state, one install) or an
  empty new account. The harness signs in through the real sign-in page with the
  stand-in's throwaway account; nothing reaches the hosted project, so a run
  needs no credentials and shows the same data every time.
- **This browser's extension, as the web app sees it**: the in-page stand-in from
  `apps/web/e2e/support/fake-extension.ts` (not installed, not connected,
  connected, connected but not on all sites, connected as someone else).
- **Extension**: `wxt build --mode e2e`, loaded unpacked into a persistent Chrome
  profile and driven with the e2e test messages, as
  `apps/extension/tests/e2e/extension.ts` does. The engine fixtures are served on
  127.0.0.1:4173 (the e2e build's host access) and 127.0.0.1:4180 (no access:
  "as the site made it" and "needs site access"). Page analysis answers come from
  the decide stand-in in `apps/extension/tests/e2e/supabase-stub.ts` (port 4175).
- **Fits and seeds**: `lib/fixtures.ts` re-exports the e2e helpers
  (`measuredFit`, `THIS_WEEK`, `strongReaderProfile`, `focusProfile`, the fake
  extension) and is bundled with esbuild at run time, so the harness adds no
  dependency. Playwright comes from `apps/web`'s dev dependencies.

## Output

`<surface>__<state>__<viewport>-<theme>.png`, plus `INDEX.md` (every image with
surface, state, viewport, theme and notes; counts per surface; everything that
was not captured, with the reason).

- Web pages: `1440` (1440x900, scale 1) light and dark, `390` (390x844, scale 2,
  touch) light. Long pages are full-page images; each public page also has a
  `first-screen` image at 1440 light. Pages that pin something to the viewport
  (Tune's action bar, the app rail) are drawn in a viewport as tall as the page,
  so the bar sits where it ends up, not over the content.
- Tune: each screen as the person sees it (the viewport), plus `<state>-full`
  when the screen scrolls. Walked with a mouse at 1440 and taps at 390; a stage
  and Your fit are also in dark.
- Popup: sized the way Chrome sizes it (its own width, which follows WebAble's
  text scale, and its content height up to 600 px); `-scrolled` shows the end of
  a popup whose body scrolls; `-scale-1.31` and `-scale-1.5` are fits with a
  21 px and 24 px text floor.
- Engine fixtures: 1440x900, before (no access) and after, plus the toast, the
  offer chip, show-on-page outlines and the reading guide.

## Changing it

Each group is one module in `lib/` (`site`, `tune`, `app`, `extension`). A
capture step is wrapped in `rec.attempt(meta, fn)`: a failure becomes a line in
INDEX.md's "Not captured" table and the run goes on. Screens are found by role
and name, the same way the e2e suites find them, so copy changes there need the
same change here.
