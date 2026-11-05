# Codex task: one small button, plain words

Read `docs/agents/ROUND8.md` first; sections 1 and 2 are your spec. Pull `main`, branch `codex/simple-ui`. You own
these, and only these:
- `apps/extension/src/ui/panel/**`
- `apps/extension/entrypoints/popup/**`
- `apps/extension/src/ui/offers/**`
- `apps/extension/src/ui/explain/**`

## The problem
The in-page panel and the toolbar popup show too much:
- gauges, a Jev counter, "learned" lists, offer cards and several named features;
- buttons ordinary people can't understand;
- engineering words.

## Build
1. **In-page sheet** (`ui/panel/`). Opened from one small round button. It contains only the five items in ROUND8 §2:
   - the site line;
   - the "Original page" switch (shown when `EngineState.calm` is open or was auto-opened; it calls
     `closeCalm()`/`openCalm()`);
   - text size smaller and bigger (`adjustText`);
   - "What changed": up to five lines from the ledger, each in plain words with Undo;
   - "Pause on this site".

   At the bottom, a small "How WebAble read this page" link calls `toggleLens(true)`. Move the Jev counter and gauges
   so they only appear with the Lens. Keep the existing `EngineApi`/`EngineState` (`apps/extension/src/contracts.ts`).
   Don't change it; if you need something, add it as optional in your own files and say so.
2. **Toolbar popup** (`entrypoints/popup/`). Show only:
   - "WebAble is on" with an on/off switch;
   - "Pause on this site";
   - "Your settings", which opens `/fitting.html` at the results page;
   - nothing else.
3. **Offers** (`ui/offers/`). Remove offer cards that ask the person to choose features. Keep only the "Show it
   again" restore for a hidden pop-up, in one plain line.
4. **Words.** Rewrite every user-facing string in your files in plain spoken English. Don't use: Calm view, Lens, fit,
   tailor, ledger, verify, rollback, decision, confidence, probability (except inside the Lens). Examples:
   - "Made the text bigger";
   - "Hid 6 ads";
   - "Paused a moving slideshow";
   - "Made faint text darker";
   - "Made buttons easier to hit".
5. Keep keyboard access, focus rings and the existing tokens.

## Done means
- typecheck, tests and build pass (update tests you change);
- push `codex/simple-ui` and reply in the thread with screenshots if you can.

Target: 06:00.
