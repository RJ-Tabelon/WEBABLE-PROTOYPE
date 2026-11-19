> Current live-study revision: protocol `mobile-live-3.0.0`, study companion `1.1.0`. Each round ends with the full ten-item SUS; four optional questions follow both rounds. Start and pause dialogs are centered, blur and block the website, and require an explicit action before timing resumes. Original two-questionnaire answers and missingness are exported under `mobile-live-v3/`; older protocols remain separate. See [content evidence](study-content-evidence-2026-10-21.md) and [questionnaire methods](study-questionnaire-evidence.md). Earlier sections below retain the implementation history. Existing companion installations must be updated/reloaded before using this revision.

# WebAble mobile study: implementation and pilot protocol

Updated October 21, 2026. Protocol `mobile-live-2.0.0` follows the user's decision to **keep the study on phones**, use real websites and reduce participant burden. The scope remains adults **50+ who use a smartphone and report difficulty tapping small controls**. See the [revision and source notes](study-live-sites-revision-2026-10-21.md). This is an implemented research tool and candidate pilot protocol, not approval to recruit or a validated instrument.

## Hosted deployment

The study preview is live at **https://webable-study.vercel.app/study?preview=1**. It is the production deployment of the separate Vercel project `webable-study` in `cadens-projects-cf0ecc8c`. The app root is `apps/web`, using Node 24, `pnpm install --frozen-lockfile`, and `pnpm run build`, with workspace source outside that root enabled. Source visibility is private; the study URL is publicly accessible.

The initial release uses deployment `dpl_56keoKXLCELZahDxZ6BqCYgS6Yks`, built from the current local working tree on October 21, 2026. No Git push or automatic Git deployment was configured. The deployed build passed the live-site activity flow, phone onboarding/Tune handoff, and save-retry browser checks before promotion. These checks use touch-emulated Chrome, not physical phones.

Only the existing public web configuration was copied to the Vercel project, with its public origin set to the HTTPS study domain. Research storage, approved retention/reference settings and signed installer URLs remain unconfigured; the hosted app therefore offers device-local preview rather than accepting participant responses. No production database migration was applied. `.vercelignore` excludes local credentials, browser authentication state, research exports and generated builds from uploads.

Safari and Firefox development companions have also been rebuilt for `https://webable-study.vercel.app`. Their unsigned artifacts are in the ignored `study-output` folder; the Safari containing-app project is `study-output/safari-package-1792609489638/WebAble Study/WebAble Study.xcodeproj`. Sign/distribute them and set the installer links before participant use.

For future manual releases, link this checkout to the existing project, deploy a staged production build, verify it, then promote that exact deployment:

```sh
pnpm dlx vercel@65.0.0 link --yes --project webable-study --scope cadens-projects-cf0ecc8c
pnpm dlx vercel@65.0.0 --scope cadens-projects-cf0ecc8c deploy --prod --skip-domain --yes
# Verify the returned deployment URL before promoting it.
pnpm dlx vercel@65.0.0 --scope cadens-projects-cf0ecc8c promote https://RETURNED-DEPLOYMENT-URL --yes
```

## Participant experience

Run `pnpm dev` and open **http://localhost:3000/study?preview=1**. Preview data stays on the device. Reviewing the guide requires no account; running its real website activities requires the study companion. Setup provides explicit connection status and configured installer links. Missing installation is reported, without silently substituting a simulated website.

Flow: agreement → phone/companion check → **existing WebAble Tune** → round 1 with two activities → untimed break → round 2 with two activities → **three optional feedback questions** → save-confirmed receipt.

The visual design remains the white/charcoal study shell informed by [reference inspection](study-design-references-2026-10-20.md). Instructions and controls remain stable between conditions. The study's calibration storage is separate from personal Tune progress and saved product fits. Calibration is described as personalization, not medical diagnosis. The visual pilot excludes screen-reader evaluation.

Each round asks the participant to find a museum article on Wikipedia and Basic Information on a National Park Service park website. Sets A/B use Gainesville/Tallahassee and Everglades/Biscayne respectively. Tasks run at the live public origins with native navigation and features. Arriving at the specified URL with its expected heading completes the activity automatically; there are no repeated target drills or recall quizzes.

## Condition and adaptation contract

| Sequence | Round 1 | Round 2 |
| --- | --- | --- |
| 0 | Original A | Adapted B |
| 1 | Adapted A | Original B |
| 2 | Original B | Adapted A |
| 3 | Adapted B | Original A |

Invitations balance blocks of four separately for pilot/main cohorts. Sequence and accepted fit cannot change after recording. Participants see round numbers; final feedback discloses which presentation was personalized. Visible differences prevent a claim of blinding. Difficulty equivalence of A/B requires observed pilots. The live Chrome-emulated check found that Wikipedia safely retains enlarged hit areas while rolling back text growth for overlap; the park page retained both text and hit-area changes. This is partial delivery on Wikipedia, not evidence that its text grew. Pilots should review that behavior and the scientific scope before freezing the catalog.

`apps/study-companion` is a separate Safari/Firefox WebExtension. Its content script imports the same real document engine and core policy as the product. Only the assigned study tab receives the frozen study fit. Original pages instantiate no adaptation engine. Automatic supported operations are `text_floor`, `target_size`, `target_spacing`, `line_spacing`, `line_length`, `contrast`, `focus_outline`, `calm_motion`. Learning, account changes, cloud analysis, AI layouts, tab zoom and product offers are outside this protocol.

The engine prepares and verifies each new document before timing. Planned/applied operations, rollbacks and sampled rendered style changes and enlarged pseudo-element hit areas are recorded. A failed preparation is a technical error. No-op fits remain no-ops and are flagged for interpretation. The Next.js text-floor import-binding failure discovered in the initial preview is fixed and covered by a rendered-font regression.

The guide can control only its built-in task catalog. Messages require the trusted guide origin and owner tab. Third-party observations require the assigned tab, top frame and allowed task URL. Query strings/fragments, typed values, page text, screenshots and browsing in unrelated tabs are not recorded. Public article paths and the assigned park are permitted; leaving scope stops the attempt. Closing the guide clears its companion run and stops recording. Finish/stop removes the companion's temporary fit/result; inactive runs expire after 30 minutes. The original v1 preview storage is preserved.

## Measures and interpretation

| Measure | Definition |
| --- | --- |
| Completion | Requested destination reached and heading checked after a timed page was recorded; report successes out of two per condition |
| Active interaction time | Monotonic visible/unpaused document time after preparation; excludes instructions, hidden time, pauses and navigation/loading |
| Effort | Click count, background clicks, scroll events and navigation count; exploration is not automatically incorrect |
| Delivery | Planned/applied operations, safety rollbacks, sampled computed style differences, software/content version |
| Deviations | Technical failures, skips, interruptions, input modality, assistance, and permitted viewport metadata |
| Feedback | Optional round preference, comfort (1–7), and one comment |

The live browsing tasks do not measure target endpoint precision or reading comprehension. The three-question survey is study-specific, not SUS/NASA-TLX or a validated clinical/usability scale. Per-document input stores the last modality and the set of observed touch, mouse, pen and keyboard activation modalities, so a later touch does not hide earlier non-touch activity. Navigation counts include the detected destination but load time is not part of active time. Live content can change; freeze the catalog version and review pages before each pilot/collection block.

Exports retain raw attempts and separate missingness/failures. Participant-level paired completion differences are adapted minus original. Paired time is descriptive and conditional on completing all four activities without recorded non-touch input; inspect delivery/no-op checks, touch evidence, order, site, set, missingness and success alongside time. Do not pool historical simulated-site data. No inferential significance or power calculation is fabricated. The chair should agree on exclusions, meaningful effect, sample size and interval/test method before main collection. The earlier proposal's four pilots/approximately 24 main participants remain exploratory targets.

## Build and distribute the phone companion

Use the exact hosted HTTPS origin of the study. Localhost origins are development-only. No database URL or personal account key is bundled.

```sh
STUDY_GUIDE_ORIGIN=https://YOUR-HOST pnpm study:companion --browser firefox
STUDY_GUIDE_ORIGIN=https://YOUR-HOST pnpm study:safari
```

Firefox output is `study-output/companion-firefox`. Submit/sign the extension for the intended Android distribution route; an unsigned folder is not an installable participant link. Android Firefox **142+** is the declared baseline; its built-in permissions disclose activity/path recording. Viewport metadata is omitted when optional technical-data permission is declined. Browser installation consent is separate from the study agreement.

The Safari command generates an iOS Xcode project under `study-output/safari-package-*`, using Apple's converter. Configure the development team, sign, and distribute the containing app/extension using the chosen Apple route. A simulator build without signing verifies compilation, not installation or physical Safari behavior. The containing app and embedded extension use the `app.webable.study` identifier hierarchy.

Set public installer links in the web configuration and run `pnpm env:sync`:

```dotenv
NEXT_PUBLIC_STUDY_SAFARI_INSTALL_URL=https://... # Actual signed iPhone installer
NEXT_PUBLIC_STUDY_FIREFOX_INSTALL_URL=https://... # Actual Android add-on installer
```

Participants open the invitation and both website activities in the same supported browser, grant the companion access to the guide/Wikipedia/NPS, and keep the guide tab open. The standalone desktop Chrome product extension is not required and should not be active on study pages during controlled testing.

## Storage and participant links

The new migration creates `research.invites` in a private schema with RLS and no `anon`/`authenticated` schema or table privileges. It has no foreign key to personal accounts or contact details. Next.js accesses it using a **server-only** PostgreSQL connection. Do not expose that connection as `NEXT_PUBLIC_*` or put it in extension settings. Prefer a dedicated server login with schema USAGE, only the required SELECT/UPDATE privileges, and private RLS policies permitting that role to operate on study rows. Table privileges alone do not bypass RLS. The table-owner connection used by the local storage check already has that access; invitation/export scripts also require the appropriate researcher INSERT/SELECT privileges.

Invitations contain 256-bit random capabilities in the fragment (`/study#invite=…`), which is removed from the address bar before exchange. Only its SHA-256 hash is stored in the database. The exchange issues a different session capability in an HttpOnly, Secure-on-HTTPS, SameSite=Strict cookie scoped to the study API. Reopening the same invitation in its original browser is idempotent; another browser cannot claim it again. Failed acknowledgements can safely retry identical saves. Revisions reject competing stale tabs. Mutations require the same origin; responses are not cached. Server errors do not expose database details or imply success.

Live progress also has a namespaced local backup. Offline changes show a visible retry state, and completion is only described as submitted after server acknowledgement. If a returning live session cannot be loaded, the interface reports the problem rather than silently substituting a preview. Preview records are separate and are never uploaded when opening a real invitation.

Leaving can retain progress. Withdrawal waits for queued saves, clears the response from the server and device, and leaves only an invitation tombstone for the participation funnel. Exported/combined research records need to be covered by the agreed withdrawal/retention procedure. Sessions expire after 30 days; retaining the code lets a person contact the researcher afterward. Neither this implementation nor a research-reference setting asserts that a determination has been granted.

### Configure collection

Collection is disabled until these server settings exist. Set their actual approved values; do not put placeholder approvals into a live invitation:

```dotenv
STUDY_DATABASE_URL=postgresql://...
STUDY_CONTACT_EMAIL=...
STUDY_RETENTION=... # Actual access, retention and deletion statement shown in the agreement
STUDY_APPROVAL_REFERENCE=... # Applicable institutional research reference
```

`pnpm env:sync` copies these only into the web server's ignored `.env.local`, never the extension. Production hosting needs the same server settings. Use the direct database endpoint or session pooler, not transaction pooler port 6543. Database migrations are additive and separate from publishing the website.

```sh
pnpm db:push --dry-run      # Review pending migrations before applying
pnpm db:push               # Apply the study migration through the existing repo workflow
pnpm env:sync
pnpm dev

# Four balanced pilot invitations; output contains private links, not emailed automatically.
pnpm study:invite --count 4 --cohort pilot --base-url https://YOUR-HOST --out study-output/pilot-invites.csv

# After pilots/protocol freeze, create balanced main invitations separately.
pnpm study:invite --count 24 --cohort main --base-url https://YOUR-HOST --out study-output/main-invites.csv

pnpm study:export --cohort main --out study-output/main-export
# Use --cohort pilot or all explicitly to inspect those cohorts.
```

Each batch must be a multiple of four. Exports contain root `responses.json` and protocol-specific folders. `mobile-live-v2` contains `participants.csv`, `task-attempts.json`, `comparison.md` and `comparisons.json`. Historical simulated data, including target taps, is written separately under `legacy-mobile-v1`. The comparison reports average participant-level differences, show sample/sequence counts, and keep pilot and main cohorts separate. They do not calculate significance. Exports exclude invitation/session credentials and preserve condition, set, order, cohort, missingness, page observations and optional feedback. Output folders/files are private by default and ignored by Git. The response code on the receipt is the first eight characters of the full coded UUID, which is retained in exports.

## Verification and remaining launch work

```sh
pnpm --filter @webable/web typecheck
pnpm --filter @webable/study-companion typecheck
pnpm --filter @webable/core test
pnpm --filter @webable/web test
pnpm --filter @webable/web exec playwright test --project study-live
STUDY_PUBLIC_SITE_SMOKE=1 pnpm --filter @webable/web exec playwright test --project study-live
pnpm study:check-storage
pnpm study:check-export
```

The default live-study browser test uses deterministic cross-origin fixtures and a real loaded companion in isolated touch-emulated Chrome. The explicit public-site smoke mode removes interception. These checks are development evidence, not physical-phone validation. Legacy simulated tasks/scoring remain available under `/study/legacy` for historical regression/export support and are not offered as a participant fallback.

Before recruitment: provide signed mobile installers, validate extension permissions, gestures, background suspension, navigation, adaptation visibility and return-to-guide behavior on **physical iPhone Safari and Android Firefox**; configure/apply the research storage migration on the chosen host; review agreement/retention/reference with the chair; observe pilots and match task difficulty; freeze protocol and software versions. No invitations have been sent, no persistent research migration deployed, and no efficacy established by automated checks.
