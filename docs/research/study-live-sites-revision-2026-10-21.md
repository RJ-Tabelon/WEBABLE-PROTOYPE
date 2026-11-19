# Mobile live-site revision — October 21, 2026

> Historical specification for protocol 2.0.0. The current protocol is 3.0.0; see [content and questionnaire evidence](study-content-evidence-2026-10-21.md) and [questionnaire decisions](study-questionnaire-evidence.md). It adds SUS after each round, four final questions, a blocking start dialog, and normal website search support. The three-question survey below describes the earlier version only.

The user retained the smartphone study and the current visual design, requested actual websites, stronger evidence of adaptations, and fewer questions. Protocol `mobile-live-2.0.0` replaces the simulated task battery. Historical preview records are preserved and exported separately.

## Implemented flow

Agreement → phone/companion check → existing WebAble Tune once → two live website activities → untimed break → two activities with the other presentation/content set → three optional feedback questions → save-confirmed receipt.

The 48 repeated selections, eight recall questions and intermediate ease ratings are removed. Final feedback asks round preference, comfort and one comment. Calibration uses the real existing Tune; its fit is frozen for both rounds and isolated from personal product storage.

The companion runs in iPhone Safari or Android Firefox. A normal webpage cannot adapt or measure other origins because of the [same-origin policy](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Same-origin_policy). The dedicated `apps/study-companion` package supplies the browser integration without changing the desktop product extension. It has no account, cloud planner or learning history. The guide opens a designated study tab at the real website origin. No local copy, proxy or simulated fallback is used.

## Activities

| Family | Set A | Set B | Completion |
| --- | --- | --- | --- |
| Find a museum | [Gainesville, Florida](https://en.wikipedia.org/wiki/Gainesville,_Florida) → Florida Museum of Natural History | [Tallahassee, Florida](https://en.wikipedia.org/wiki/Tallahassee,_Florida) → Tallahassee Museum | Specified Wikipedia article and expected heading |
| Plan a park visit | [Everglades Plan Your Visit](https://www.nps.gov/ever/planyourvisit/index.htm) → Basic Information | [Biscayne Plan Your Visit](https://www.nps.gov/bisc/planyourvisit/index.htm) → Basic Information | Specified park's Basic Information page and expected heading |

Four sequences balance condition, content and order. These are candidate task pairs, not empirically matched difficulty. Wikipedia article links and browser Find on Page are permitted; account, edit and search namespaces are outside the activity. Park browsing stays within the assigned park. Leaving scope stops measurement as a technical interruption. No purchases, logins or personal form entries are required.

## Measurement

Success is destination-based; ordinary exploratory clicks are not errors. Active time uses a monotonic clock after engine preparation, excluding explicit pauses, instructions, hidden tabs and page loads. This is active interaction time, not wall-clock completion time. Clicks, background clicks, scroll events and navigation counts are descriptive effort measures. They do not establish target precision or comprehension.

Every prepared document records planned/applied operations, rollbacks, engine version, and sampled before/after computed styles and actual enlarged hit-area pseudo-elements. The real extraction/policy/application/verifier engine is shared with WebAble. Original pages instantiate no adaptation engine. A rendering failure is a technical failure, never successful intervention delivery. A legitimate no-op fit is not forced into an aggressive intervention; inspect no-ops and visible-change checks when interpreting comparisons.

Only the assigned tab is measured. Stored page paths exclude query strings and fragments; typed values, page text and screenshots are not recorded. Recorders stop on departure, skip, withdrawal or owner-tab closure. The companion's local run/profile is removed after completion/stop, or expires after 30 minutes without recorded updates. Firefox's optional technical-data permission controls recording of viewport metadata. The study guide separately records its disclosed setup and accepted calibration.

## Distribution and validation

See [implementation instructions](study-sandbox-implementation.md) for builds, configuration and tests. Safari uses an iOS containing app; Firefox uses an add-on. These are development packages until signed and distributed through the relevant platform. [Apple packaging documentation](https://developer.apple.com/documentation/safariservices/packaging-a-web-extension-for-safari) describes the Safari containing-app route. [Mozilla Android documentation](https://extensionworkshop.com/documentation/develop/developing-extensions-for-firefox-for-android/) describes Android extension development. Firefox 142+ is required on Android to support its [built-in data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/).

Automated Chrome touch emulation verifies the cross-origin companion integration; it does not establish physical Safari/Firefox compatibility. Signing/install links, real-phone gesture and lifecycle checks, observed pilots, difficulty matching and chair-approved protocol/collection configuration remain necessary before recruitment. The study is not represented as a validated instrument or an established treatment effect.
