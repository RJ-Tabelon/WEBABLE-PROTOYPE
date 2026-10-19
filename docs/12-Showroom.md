# 12. Showroom: Fit view, redesigned

_Written 2026-10-18. Replaces the visual language of docs/10 §4.3 and the planner's layout vocabulary (docs/10 §6).
Keeps every guarantee in docs/10 §4.4–4.7 and docs/11 (same words, every control works, nothing lost, one click
back)._

## 1. Why

Caden's verdict after using Fit view on real pages: "this is not 1995". The before screenshots (YouTube search, Amazon
search and product, Wikipedia, BBC, GOV.UK; 2026-10-18) show why:

- **The black screen.** When the profile states no polarity, the palette followed the OS dark mode. A contrast floor of
  21 then gave pure `#000` with `#FFF` text and a 2 px white rule around every card, pill and drawer.
- **Flat type.** The tier ratios were 1.8 / 1.45 / 1.25 × body, every heading was weight 700, and every control was 600,
  all in Atkinson Hyperlegible. Everything shouts at once and nothing leads.
- **Narrow and boxed.** A 700 px column was centred in a 1440 px window. Every control was an outlined pill, and lists
  were bordered boxes.
- **Small media.** YouTube results became rows with 96 px thumbnails and an "Action menu" button on every row. The
  Amazon product image was 200 px.

## 2. The reference: Apple and the Google Store

Measured with computed styles on apple.com, apple.com/store and store.google.com (1024 px viewport, 2026-10-18):

| | apple.com / Apple Store | Google Store |
| --- | --- | --- |
| Face | SF Pro Display (≥ 20 px) / SF Pro Text, negative tracking (−0.374 px at 17 px, −1.2 px at 80 px) | Google Sans Flex |
| Body | 17 / 25 px, `#1D1D1F` | 16 / 24 px, `#191C1D` |
| Secondary text | `#6E6E73` | `#3C4043` |
| Page heading | 80 / 84 px, 600 (Store); 48 / 52 px, 600 (tile headline) | 60 / 68 px, 500, −1 px |
| Section heading | 28 / 32 px, 600; a grey continuation in the same size ("The latest. _Take a look at what's new._") | 48 / 56 px, 500 |
| Card title | 21–24 px, 600 | 16 / 24 px, 700; price 16 px 500 |
| Eyebrow | 12 px, 600, `#B64400` | "New", 12 px, 500, blue |
| Canvas | `#F5F5F7` with white cards; full-bleed white and black tiles on the home page | white, with tinted panels (`#FBE9E3`, `#F8F9FA`) |
| Cards | white, radius 18 px, shadow `2px 4px 12px rgba(0,0,0,.08)`, 400 × 500 px, 20 px gaps | image well `#F9F9F9`, radius 20 px; panels radius 28 px |
| Buttons | pill (radius 980 px), 44 px tall, 17 px text; filled `#0071E3` or outlined `#0066CC` | pill (radius 100 px), 48 px tall, 16 px 500; outline 1 px ink, or a blue text link "Buy ›" |
| Navigation | 44 px, `rgba(255,255,255,.8)`, `backdrop-filter: saturate(180%) blur(20px)` | floating 52 px bar, a pill "Sign in" in `#0B57D0` |

The two share a language: one idea per band, generous space, large confident headings, product media that dominates in
soft wells, rounded cards with soft elevation, pill buttons, neutral surfaces, and a single blue for actions. Both work
for every age because they show few things at once and make each thing large and obvious. WebAble's research already
asks for exactly that (docs/11 R1–R9).

## 3. Principles

1. **One idea per band.** The view is a vertical sequence of bands. Each band has a heading, an optional grey count and
   one kind of content.
2. **Hierarchy by size, not weight.** Use three heading sizes far apart (§4.2) at weight 600. Body is 400. There is no
   700 anywhere unless the person's weight floor asks for it.
3. **Media leads.** Thumbnails and product images are large, sit in soft wells and are rounded. A list of videos is a
   grid of 16:9 cards, never rows of stamps.
4. **Surfaces, not borders.** Show structure with white cards on a grey canvas and soft shadows. Borders are hairlines,
   used only where a control needs an edge. At "more" and "max" contrast, edges come back because the person needs them.
5. **One action colour.** The site's actions are blue: filled for the one primary action, blue text for the rest. Fern
   still means only "WebAble did this" (the strip, the intro line, drawer counts).
6. **Light by default.** The view is light unless the person's fit says dark (stated, or measured faster on dark in
   Tune). The OS dark setting alone no longer turns the view dark: the reference stores ignore it, and the OS setting
   is a taste, not a measured need. When the view is dark, it is Apple's dark (§4.1), not black and white.
7. **Calm motion.** Hover lifts (2 px, 180 ms) and colour fades only. There are no carousels and no autoplay, and
   reduced motion removes all of it.

## 4. Visual system

### 4.1 Palettes (Fit view only; decoupled from `packages/tokens/tokens.css`)

Fit view re-presents other sites, so it gets its own palette. The web app and popup keep "Made to Measure". The two
share only the fern accent, and `styles.test.ts` checks just that.

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--canvas` | `#F5F5F7` | `#000000` | page background |
| `--surface-raised` | `#FFFFFF` | `#1C1C1E` | cards, panels, the reading sheet |
| `--surface-tonal` | `#E8E8ED` | `#2C2C2E` | chips, search field, secondary buttons, media wells in dark |
| `--surface-hover` | `#DCDCE1` | `#3A3A3C` | hover on tonal |
| `--surface-press` | `#D2D2D7` | `#48484A` | pressed |
| `--well` | `#F5F5F7` | `#2C2C2E` | media wells inside cards |
| `--ink` | `#1D1D1F` | `#F5F5F7` | text |
| `--ink-2` | `#5E5E63` (≥ 5.3:1 on every light surface) | `#A1A1A6` | secondary text, counts, meta |
| `--line` | `#D2D2D7` | `#38383A` | hairlines (decorative) |
| `--line-strong` | `#86868B` (≥ 3.3:1) | `#8E8E93` | control edges |
| `--action` / `--on-action` | `#0071E3` / `#FFFFFF` (4.7:1) | `#0071E3` / `#FFFFFF` | the site's primary action fill |
| `--action-hover` | `#0077ED` | `#0077ED` | |
| `--link` | `#0066CC` (≥ 5.1:1) | `#2997FF` (≥ 5.6:1 on raised) | the site's links and text actions |
| `--badge` | `#B64400` | `#FF9F45` | badges ("New", "Best seller") |
| `--accent` / `--on-accent` | `#2D6A3E` / `#FFFFFF` | `#8FCB9B` / `#0F1A12` | WebAble's own controls only |
| `--accent-hover`, `--accent-tint` | `#22552F`, `#E4EFE6` | `#A9D9B2`, `#1B2B1F` | |
| `--warning`, `--warning-tint` | `#7A4800`, `#FAEFD9` | `#F2B75E`, `#2E2412` | |
| `--focus` | `#0071E3` | `#2997FF` | focus ring |
| `--selection` | `#B3D7FF` | `#1F4E85` | |
| `--glass` | `rgba(255,255,255,.72)` | `rgba(22,22,23,.78)` | the frosted strip |
| `--shadow-card` | `0 1px 2px rgba(0,0,0,.04), 0 6px 20px rgba(0,0,0,.06)` | `none` | card elevation |
| `--shadow-lift` | `0 2px 4px rgba(0,0,0,.05), 0 12px 32px rgba(0,0,0,.10)` | `none` | hover |
| `--shadow-float` | `0 12px 40px rgba(0,0,0,.16)` | `0 12px 40px rgba(0,0,0,.6)` | menus, the More panel, peek |

- **More contrast:** `--ink-2` becomes `--ink` and `--line` becomes `--line-strong`. `--link` and `--action` become
  `#0040DD` (7.6:1) in light and `#6CB4FF` in dark (with `--on-action` `#000`). Cards gain a 1 px `--line-strong` edge.
- **Max contrast, light:** canvas, raised and well are `#FFFFFF`; tonal is `#F0F0F0`; ink, ink-2, line and line-strong
  are `#000000`; link and action are `#0040DD`; badge is `#8A2E00`; focus is `#000000`; no shadows. Cards and controls
  get a 2 px edge.
- **Max contrast, dark:** canvas and raised are `#000000`; tonal and well are `#1A1A1A`; ink, ink-2 and line are
  `#FFFFFF`; link is `#6CB4FF`; action is `#6CB4FF` with `--on-action` `#000000`; badge is `#FFB366`; focus is
  `#FFFFFF`. Edges are 2 px, but only on cards and controls. Radii, spacing and type stay exactly as in the standard
  palette, so max contrast looks designed, not like 1995.

### 4.2 Type

- **Face:** the system UI face by default. The stack is `-apple-system, BlinkMacSystemFont, "SF Pro Text",
  "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`; headings use the same stack with
  `"SF Pro Display"` / `"Segoe UI Variable Display"` first.
  - The solver now returns `type.font: 'system'`. The Atkinson path (`fonts.ts`) stays for a future legibility setting.
  - `font-size-adjust: ex-height 0.536` applies to every face, so F still means what Tune measured.
- **Tiers** (`typeRamp`, `packages/core/src/fit/typeramp.ts`). Ratios to F are interpolated between anchors:

| F | pageHeading | sectionHeading | title |
| --- | --- | --- | --- |
| ≤ 16 | 2.5 | 1.75 | 1.25 |
| 24 | 2.0 | 1.5 | 1.17 |
| 32 | 1.6 | 1.3 | 1.12 |
| ≥ 40 | 1.35 | 1.18 | 1.08 |

- **Weights:** 600 for the three heading tiers, 400 for body, and 500 for controls, prices and badges. The person's
  weight floor raises every weight.
- **The five text styles (R8):** page×600, section×600, title×600, body×400, body×500.
  - Meta is body×400 in `--ink-2`.
  - A badge is body×500 in `--badge`.
  - The site name in the strip is body×500.
  - Nothing else may introduce a size or weight. `metrics.ts` counts these pairs.
- **Leading:** page 1.08, section 1.14, title 1.25 (never below 1.15 once the person's line height is above 1.5). Body
  uses the person's line height.
- **Tracking:** page −0.022 em, section −0.016 em, title −0.01 em, body 0. This applies only when the person's letter
  spacing is 0; otherwise their spacing applies everywhere.
- **Long page titles:** an h1 longer than 70 characters (an Amazon product name) is drawn at the section size. It stays
  an h1 with class `t-page t-page--long`.

### 4.3 Shape, space and elevation

- **Radii** (px at 100%, divided by zoom like every length):
  - card 22, panel 28 (hero, spotlight, buy-box media well, the reading sheet), media 16, field 14;
  - controls and chips are pills (999).
- **Width:** `.fv-page` is at most 1280 px with side padding max(24 px, 4vw, F). Prose stays within the person's line
  length (`maxLineCh`) inside it. Grids use the full width.
- **Rhythm:**
  - band gap is max(64 px, 4F);
  - head-to-content gap is max(20 px, 1.25F);
  - card gap is max(20 px, F);
  - card padding is max(20 px, 1.25F);
  - every one is clamped so the primary section still starts within 0.5 (level 2) or 0.6 of the first screen
    (`PRIMARY_START_SHARE`).
- **Targets:** every control is at least T in both dimensions and at least `--fv-ctl` tall (docs/10 §4.2). Pills get
  horizontal padding of max(20 px, 1.25F).
- **Elevation:** cards use `--shadow-card`; on hover (pointer only) `--shadow-lift` with `translateY(-2px)` over 180 ms,
  unless motion is reduced.

## 5. Components and the DOM contract

Existing class hooks stay, because tests and the live layer use them: `.fv-strip`, `.fv-wa`, `.fv-wa-controls`,
`.fv-search`, `.fv-orient`, `.fv-pageline`, `[data-primary]`, `.fv-section`, `.fv-rec`, `.fv-card`, `.fv-row`,
`.fv-grid`, `.fv-rows`, `.fv-facts`, `.fv-rec__more`, `.fv-listmore`, `.fv-drawer`, `.fv-rest`, `.fv-product__*`,
`.fv-picker`, `.fv-outline`, `.fv-more`. New classes are added beside them.

| Component | Owner file | Look |
| --- | --- | --- |
| **Strip** `header.fv-strip` | render.ts, styles.ts | Sticky, frosted (`--glass` + `backdrop-filter: saturate(180%) blur(20px)`, hairline below), height max(56 px, T + 12). Left: site name (body×500). Middle: the site's search as a pill field (`--surface-tonal`, no border, a leading magnifier SVG, `aria-hidden`), its submit a tonal pill. Right: WebAble's group. **Text − / Text +** form one segmented tonal pill (`.fv-seg`), **Original page** is a filled fern pill, and **More** is a ghost pill. The More panel floats (`--shadow-float`, radius 22). |
| **Hero** `header.fv-orient` | render.ts, styles.ts | The page's h1 at page size, then `.fv-pageline` (body, `--ink-2`), then the hero details (a channel's avatar, a result count) and the page's tabs or chips as a chip bar. Left-aligned. Padding-top max(32 px, 2F). Articles centre it on the reading column. |
| **Section head** `.fv-section__head` | sections.ts, styles-sections.ts | h2 at section size, then an optional `.fv-section__count` (same size and weight, `--ink-2`), Apple's "The latest. _Take a look._" pattern. Counts come from the spec, never generated prose. |
| **Primary site action** `.fv-btn--fill` | components.ts, styles.ts | `--action` pill, `--on-action` text, body×500. |
| **Other site actions** `.fv-btn` | components.ts, styles.ts | Tonal pill, ink text, body×500. `.fv-btn--link` is blue text with a trailing chevron SVG, no fill, still ≥ T tall. |
| **Chips** `.fv-pill` | components.ts, styles.ts | Tonal pill. Selected (`aria-current`, `aria-pressed=true`, `aria-selected=true`) is filled `--ink` with `--canvas` text. |
| **Fields** `.fv-input`, `.fv-check`, `.fv-options` | components.ts, styles.ts | Raised field, 1 px `--line-strong`, radius 14, ≥ `--fv-ctl` tall. Focus is a 2 px `--focus` border plus the ring. Radio option sets are segmented tonal pills. |
| **Media** `.fv-thumb` | components.ts, styles.ts | Radius 16. Products and images use `object-fit: contain` on `--well` with 8% padding; video and story media use `cover`. The duration badge sits bottom-right: `rgba(0,0,0,.72)`, white body×500, radius 8. |
| **Drawers** `.fv-drawer` | sections.ts, styles-sections.ts | A raised card (radius 22). The summary row is ≥ T tall: title (title×600), a count chip (tonal, body×500) and a chevron in a tonal circle that turns 180°. The open content sits inside the card. |
| **Reading** `.fv-article` | article.ts, styles.ts | A raised sheet (radius 28) on the canvas, padding max(32 px, 2F), the column at the person's line length. Figures are radius 16 with `--ink-2` captions. The outline (`.fv-outline`) is a tonal card of blue links. |
| **WebAble notes** (`.fv-intro`, `.fv-offer`, `.fv-notice`, `.fv-status`) | render.ts, styles.ts | Floating raised cards (radius 22, `--shadow-float`) with a fern dot. Never full-width bars. |

## 6. The art direction contract (PageSpec v2)

### 6.1 Section layouts (`SECTION_LAYOUTS`, renamed values)

| Layout | What the renderer draws | Default for kinds |
| --- | --- | --- |
| `hero` | the hero (§5); at most one | page_heading, promo_hero |
| `buy_box` | at ≥ 900 px, two columns 7 : 5: a panel-radius media well (`contain`, max-height 62vh) beside the title, rating, price (title size), options, quantity, and full-width pills for the actions (primary filled, the rest tonal). The delivery and returns facts sit in a tonal box. One column below 900 px. | product_detail |
| `card_grid` | a collection as cards, `repeat(var(--fv-cols), minmax(0,1fr))` with `gridColumns` | main_list or related with visual records |
| `row_list` | a collection or links as one raised, grouped list (radius 22) with inset hairline separators; each row ≥ T, trailing chevron for openers | main_list with text records, comments, secondary_nav links |
| `chip_bar` | a wrapping row of chips (never a horizontal scroller) | tabs, filters, sort_and_view, breadcrumbs, pagination |
| `reading` | the reading sheet | article |
| `spotlight` | a raised panel (radius 28): text left (heading at section size, body, actions as pills), media right in a well, stacked below 900 px | feature_blocks |
| `link_grid` | links in columns ≥ 14F wide, `--ink-2` text, underlined on hover and focus; on the canvas, no card | footer, legal, primary_nav when long |
| `form_panel` | a raised panel (radius 22), labels body×500 above fields | form |
| `menu` | one button that opens the links or options (existing behaviour) | long filters, long nav |
| `as_is` | the existing as-is frame, now in a radius-16 frame | media, ads, clutter, overlay_modal, toolbar |

### 6.2 Collections: `card`, `media`, `lead`

| `card` | Look | Default `item_kind` |
| --- | --- | --- |
| `tile` | A raised card. The media sits in a `--well` (radius 16) at the media shape, `contain`. Then the badge, the title (title×600, ink), the price (body×500), facts in `--ink-2`, and the action as `.fv-btn--link` at the bottom (`margin-top: auto`, so actions line up across a row). | product, feature |
| `media` | No card chrome. Cover media (radius 16) with its duration badge, then the title (title×600), the channel and meta in `--ink-2`. An `overflow_menu` field is a 1T round tonal icon button (⋯) beside the title, carrying the site's accessible name; it is never a text pill on every record. | video, image |
| `story` | A raised card. Optional media flush on top (cover, radius 22 at the top corners), then the eyebrow (badge or timestamp, `--ink-2`), title, description, meta. | article_card, post, event |
| `row` | A row in a grouped `row_list`. The title is `--link` (results read as links), with the snippet in body and the meta in `--ink-2`, and an optional 1:1 thumb (radius 12) on the leading side. | search_result, reference, file, comment, other |
| `message` | An inbox row. A 10 px `--link` dot when the original row is bold (unread). The sender is title×600 when unread and body×500 when read, then the subject (body), the snippet (`--ink-2`) and the time trailing. | message |
| `person` | A circular avatar at max(48 px, 3F) beside the name (title×600) and meta. | person |
| `chip` | A chip in a chip bar. | tab, chip, filter_option |
| `link` | A plain link in a `row_list` or `link_grid`. | nav_link |

- **`media`:** `landscape` is 16:9, `square` 1:1, `portrait` 3:4, and `none` means no media slot. The heuristic derives it
  from the exemplar's thumbnail box (w/h ≥ 1.3 is landscape, ≤ 0.85 portrait, otherwise square; no thumbnail is none).
  The planner chooses it from the same boxes in the outline.
- **`lead: first`:** the first record spans two columns, its media at landscape. The validator sets `lead` to `none`
  unless the card is `media` or `story` and the page type is feed, home_portal, channel_or_profile or article.
- **Grid columns:** `gridColumns` is unchanged. The minimum widths are max(260 px, 13F) for `tile`, max(280 px, 14F) for
  `media`, and max(300 px, 16F) for `story`, capped by `maxCols`. A `media` or `tile` collection stays a grid down to 2
  columns. Below that it becomes one column of the same cards, never stamp rows.
- **Template consistency (R7)** is unchanged: every record of a list has the same fields in the same order and size.

### 6.3 Planner (OpenAI) and heuristic

- **Schema:** `COMPOSE_SCHEMA_VERSION` becomes `wa-compose-2.0.0` and the prompt cache key `wa-compose-v2`. Each section's
  `layout` takes the §6.1 values. Each collection gains required `card`, `media` and `lead`. Bumping the version
  invalidates every cached spec, and the function and extension ship together.
- **Prompt:** the "Layouts" paragraph becomes an "Art direction" section.
  - It explains the Showroom style, each layout and each card, and how to read media shape and lead from the outline
    (exemplar boxes, page type).
  - It states the rules the validator enforces: one hero, `buy_box` only for product_detail, `lead` only where allowed.
  - The model still returns only enums and ids: no text, no CSS, no code (invariant 4).
- **Validator:** coerces unknown values to the per-kind default (`LAYOUT_OF`, `CARD_OF`, `MEDIA_OF`). It demotes a second
  hero to the kind default, `buy_box` outside product_detail to `reading`, a `chip` card on a record kind to the kind
  default, and an illegal `lead` to `none`. Each repair is logged with a new repair kind.
- **Heuristic:** emits the same fields from the tables, plus the media shape from the exemplar box. It stays the paint
  path.
- **On screen:** the cached planner spec is used on open when its coverage is ≥ 0.8, as before. A fresh planner spec is
  still offered ("A better layout is ready"), never swapped in under the person.

## 7. What does not change

- the page's words, the order of records within a list, where links go, what a control does;
- the proxy and live layer, the firewall, conservation, the closed shadow root;
- R1–R9 and the scorecard (docs/11 §4). It must still pass on the eight reference pages;
- the data that leaves the device (only public vocabulary in the outline, `ai_layout` consent, receipts);
- Tailor (in-place zoom), which is not part of this redesign.

## 8. Acceptance

- **Tests:**
  - `pnpm typecheck`, `pnpm test`, `pnpm test:functions` and `pnpm build:functions --check` pass;
  - the extension's v2 Playwright suite passes, with its palette and class expectations updated to this document;
  - the scorecard targets hold on the eval pages.
- **Looks:** `node scripts/eval/run.mjs --sites youtube-search,amazon-search,amazon-product,wikipedia,bbc-article,govuk-browse
  --personas focus,large-text`, with the heuristic and planner views judged by eye against §2. The bar: a person who
  had never seen the original would believe the view is a well-designed site of its own.

## 9. Status (2026-10-18)

Built on the uncommitted branch `caden/webable-v1`; the Edge Function is not deployed.

**Code:**
- Contract and planner: `COMPOSE_SCHEMA_VERSION` `wa-compose-2.0.0`, prompt "Art direction", validator repairs
  `hero_demoted`, `buy_box_demoted`, `card_demoted`, `lead_dropped`, heuristic tables in `constants.ts`.
- Visual system: `styles.ts` (`FV_PALETTES`), the type ramp, light by default (`solver.ts`), system face, controls at
  least 44 px (`FIT_CONTROL_MIN_PX`).
- Sections and records: `records.ts`, `sections.ts`, `parts.ts`, `styles-sections.ts`.
- `fitview.js` budget raised to 250 KB; it loads only when Fit view first opens.
- The eval gained a `low-light` persona (dark, contrast 21), the palette that produced the black screen.

**Checks:**
- core 1218, extension 658 and web 490 unit tests pass; 198 function tests pass.
- Playwright: v2 143/143 and engine 118/118 on the final runs. Two timing tests failed occasionally under full-suite
  load and passed on their own: "late AI cannot add a new change" (engine, which does not touch Fit view) and the
  strip's intro line (v2).
- The CI verify job passes on a clean copy.

**Real pages** (`scripts/eval/run.mjs`, six sites × focus, large-text, low-light). Every level-2 target is met on
YouTube search, Amazon search and product, Wikipedia, BBC and GOV.UK:

| Page | Before | After |
| --- | --- | --- |
| YouTube search | rows of 96 px thumbnails, an "Action menu" pill per row | a grid of 16:9 cards, a ⋯ menu beside each title, the query as the title |
| Amazon search | two narrow bordered columns, heavy bold titles | Google-Store tiles: picture wells, title, price and rating, "See options ›" |
| Amazon product | a 200 px picture, outlined pills | a buy box: large picture well, price at title size, a blue "Add to cart" pill, delivery facts in a tonal box |
| Wikipedia, BBC | a plain column | a reading sheet with an Apple-Newsroom headline |
| GOV.UK | bordered list | one grouped list with blue titles |

**Open:**
- Deploy the `compose` function together with the extension. Ask first.
- When YouTube serves its alternate results layout (main content 6.5 screens down), the heuristic can read the page as
  an article. This predates the redesign (heuristic robustness).
- The level-0 template-consistency gap on Amazon product (5 mismatches) predates this redesign.
