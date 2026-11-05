## Inspiration

WebAble was inspired by Caden’s honors thesis research into AI and web accessibility, and a question we wanted to explore: how could a website adapt to the person using it?

Checking a bill, refilling a prescription, or looking up health information can be personal tasks. When the text is too small, a button is difficult to click, or the instructions are hard to follow, someone may need another person to take over. That can mean giving up privacy and control over something they wanted to do themselves.

We wanted to build a tool that helps people handle those everyday tasks on their own terms. For Gator Hack, we built WebAble around the needs of the person browsing.

## What it does

WebAble is a Chrome extension that adapts how websites look, read, and organize information for an individual.

It starts with short activities involving reading, pointing, and finding things on real websites. These help establish useful starting settings for text size, contrast, click areas, and clutter.

Users can also ask an AI assistant they already use to describe how they like information explained, then paste its answer into WebAble. They review the preferences WebAble takes from that answer and can switch off anything that is wrong.

As they browse, WebAble can:

- Make text easier to read and controls easier to click.
- Reduce distractions and organize reading pages around their main content.
- Rewrite difficult passages using the person’s explanation preferences.
- Present information as steps, key facts, definitions, or comparisons where those formats help.

The original content remains available. Users can compare versions, undo changes, or pause WebAble on a site.

## How we built it

We built a Chrome extension with **TypeScript, Preact, and WXT**, supported by a **Node.js and Hono** server that handles model calls and caching. Shared logic handles personalization, page analysis, and checks.

We combine OpenAI’s language models with **Jev**, TypeSafe’s decision model. The language models interpret imported explanation preferences and draft personalized wording and layouts. Jev helps identify what page elements do, assess which passages need a change, and evaluate proposed versions against the source.

Our frontier technology is **Jev 1.14**, released on **October 14, 2026**. Its fast, structured judgments let us ask many focused questions about a page. [TypeSafe model documentation](https://docs.typesafe.ai/models)

Code separately checks numbers, links, quotations, and layout. Proposals that fail the checks keep the original content. For personalized rewriting and layout, selected page text and enabled reading preferences are sent to the model services.

## Challenges we ran into

**Keeping the meaning while changing the presentation.** An early version simplified a sports page but dropped the record and team logos. A cleaner page is useful only if it preserves what someone came to find. We added richer page understanding, content extraction, and preservation checks.

**Working across different websites.** Sites organize their content in very different ways. Enlarging text or controls can introduce overlap or sideways scrolling, so we built checks that can reverse changes when they detect a problem.

**Making personalization useful without making setup exhausting.** Our early interface had too many controls and technical terms. We simplified it around short activities, plain explanations, and reversible changes.

## Accomplishments that we're proud of

We built a working prototype that connects what it learns during onboarding to visible changes on real websites, including personalized explanations and layouts.

We also built an evaluation harness to measure behavior beyond our chosen demo pages. In an automated test of an earlier build, **32 of 50 popular sites passed our text-enlargement and layout criteria**. That run tested in-place adjustments with AI rewriting and generated layouts disabled. It used one saved configuration and was not a study with people.

During that run, WebAble reversed **22 changes across 15 sites** after checks failed. Jev’s page-understanding call had a median round-trip time of **430 milliseconds**; complete page adaptation took longer.

## What we learned

Personalization involves more than making everything bigger. Someone may need larger text, clearer wording, a different information layout, or a combination of changes.

We learned to give models focused jobs and keep checks in code. Generating a readable version is one part of the problem; preserving warnings, conditions, and useful links is another.

We also learned to separate a convincing demonstration from evidence of benefit. Automated checks help us find failures, but testing with people is necessary to learn whether WebAble makes their tasks easier.

## What's next for WebAble — AI That Adapts the Web to You

- **Test with people:** measure task completion, missed clicks, comprehension, and user preference with WebAble on and off.
- **Improve coverage:** fix failures on more websites and evaluate personalized rewriting and layouts separately from text-size adjustments.
- **Validate onboarding:** check whether its suggested settings match what users find comfortable and useful.
- **Simplify installation:** the prototype currently requires a local server; we want to make it easier to try and use.

We want more people to handle everyday web tasks privately, independently, and on their own terms.
