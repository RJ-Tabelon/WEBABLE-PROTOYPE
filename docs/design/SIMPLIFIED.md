# The simplified page: fixes from Caden's CNN review (round 8b)

This review is of a CNN article in the simplified page. The top of the page is good; everything below the article is
the problem. WebAble dumped the site's chrome into the page as if it were content.

## What each screenshot shows

1. **"More on this page" → "Related items 12".**
   - The items are the site's share buttons ("share with facebook", "share with x", "copy link to clipboard", "Share
     with Threads"), each repeated two or three times because CNN has share bars at the top and bottom.
   - Their raw lowercase labels are shown with a meaningless bookmark icon.
   - One real related story shows under the placeholder title "Related card".
   - Counts ("6", "12") disagree with each other and mean nothing to a reader.
   - The 3-column grid mixes one image card with text items, so the vertical gaps are huge and uneven.
2. **"Up next" squeezed into a third of the width.**
   - Headlines wrap three words per line at the person's text size.
   - The other two columns hold only a heading, "share with Email".
   - The page is wider than the window: the top bar's "Original page" and the WebAble button are cut off on the right.
3. **A "Sponsored" section.**
   - It contains "Paid Content" and "Dianomi ad container (4015-358) · It is shown on the page itself · Show it on the
     page", which exposes an internal ad name and makes no sense.
   - Then "Site links" (Submit, Politics, Visit us on X/Instagram/YouTube), a 130 px tall empty "Search" box, and
     "Follow CNN Politics".
4. **Account and app links.**
   - Subscribe, Sign in, Listen, Watch, "Download the CNN app" and "Download on Apple App Store" sit one per row with
     about 160 px between rows.
   - "Listen" is indented differently from the others.
5. **The whole site footer.**
   - "About CNN", "Open Menu Icon" (an icon button's machine label), "CNN logo" twice, Terms, Privacy, Cookies, Ad
     Choices, Advertise, Accessibility, About, Subscribe, Newsletters, Transcripts, Sitemap.
   - Then "Share and save: Play, Listen".
   - All underlined, all with chevrons.

Caden also measured the width: content fills about 60% of the screen. It should be about 80%.

## Rules to fix it

### 1. The simplified page shows the main content and only what helps with it
Drop these entirely:
- share, save, print and copy-link tools;
- social "follow" and "visit us on" links;
- app-store and "download the app" promos;
- subscribe, sign-in and account links;
- ad containers and "Sponsored" or "Paid content" blocks (the Ad tag rule applies only to paid items dressed as stories
  inside the main list);
- newsletter boxes;
- search boxes on reading pages;
- the site's navigation and legal footer.

Nothing is lost: at the very end, one closed disclosure, "Site links (N)", holds the de-duplicated navigation and
footer links as a compact two- or three-column list. The Ad count lives only in the WebAble sheet's "What WebAble did
here".

### 2. Never show a machine label or a placeholder
- Drop any item whose only label matches any of these:
  - icon, logo, container, button, svg, image, "(1234-56)" style IDs;
  - "share with …", "copy link";
  - a lowercase aria-label that reads like code.
- Never print fallbacks such as "Related card" or "Related item". An item with no real title is dropped.
- Clean real labels: trim them and fix all-lowercase to sentence case.

### 3. De-duplicate
Items are the same if they have the same `href`, or the same normalised text. Keep the first.

### 4. Width: about 80% of the screen is content
- **Content column:** `min(80vw, 1400px)` at ≥ 1280 px; `88vw` from 900 to 1280; `92vw` below 900.
- **Body paragraphs:** up to 85 characters. Long lines read as fast as medium ones (Dyson 2004), and the person's
  text size widens each character anyway.
- **Media, tables, card grids and the scoreboard:** use the full column.
- **Never scroll sideways:** `overflow-x: clip` on the page root, every image `max-width: 100%`, and wide tables
  scroll inside their own box. The top bar and the WebAble button must always be fully on screen.

### 5. Related stories and "Up next" are one clean list or one clean grid
- Show only items with a real title, as uniform cards: an image on top if there is one, then the title in ink at
  weight 600, then optional meta such as "6 min read".
- The grid uses `repeat(auto-fill, minmax(340px, 1fr))` with 24 px gaps. When the person's text is enlarged (body
  over 18 px), use a single column of rows instead: a thumbnail on the right, the title on the left.
- Never put an unrelated section beside another in columns.
- Name the section "More from {site}". No counts.

### 6. One spacing scale
- The spacing scale is 8 / 16 / 24 / 40 / 64.
- List rows: 16 px padding with a hairline between rows.
- Sections: 64 px apart, with a hairline and an h2.
- Nothing gets an 80 px or larger gap inside a section. One left edge for everything: no indented items.

### 7. Promote what helps, quietly
If the article has its own "Listen" or "Play audio" control, show one "Listen to this article" button under the byline
that presses the page's own control. Otherwise, never show it.

### 8. Calm links
- In lists, titles are links without underline until hover or focus.
- No chevrons on every item; one chevron only on a disclosure.
