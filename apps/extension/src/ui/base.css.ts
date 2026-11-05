// Owner: C, D (round 4: Calm view v3). CSS for constructed stylesheets inside our shadow roots. Never use url() or
// @import (page CSP blocks them).
//
// - `baseCss`: host reset, default light tokens and shared primitives (pills, cards, the fern dot) for all WebAble UI.
// - `calmCss`: the Calm view, every selector scoped under `.wa-calm`. CalmView adopts it into its own root node itself,
//   so it renders correctly whether or not the host also adopted `baseCss`.
// - `calmChromeCss`: rules for the in-page chrome's shadow root while the Calm view is open (the floating chips hide;
//   round 8: WebAble's pill stays, it is the one control on every page). Keyed on `[data-calm-open]` on `.wa-root` (or the host), and on the open Calm host itself.
// Tokens are CSS custom properties `--wa-*` from tokens.ts; the Calm view sets fit-sized values inline on its root.
// The Calm host is CSS-zoomed by 1 ÷ page zoom, where vw / vh no longer match the screen: viewport lengths use
// --wa-vw / --wa-vh (the viewport in the view's own px, set on the host), with vw / vh only as fallbacks.
import { tokensFor, tokensToCss } from './tokens';

/** Pills, cards and small shared pieces. `s` is a scope prefix ('' for the whole shadow root, '.wa-calm ' for the view). */
function primitives(s: string): string {
  return `
${s}.wa-btn{appearance:none;-webkit-appearance:none;border:0;margin:0;display:inline-flex;align-items:center;justify-content:center;gap:.45em;
  min-height:var(--wa-ctl);min-width:var(--wa-ctl);padding:0 var(--wa-pill-pad);border-radius:var(--wa-r-pill);
  font-family:var(--wa-font);font-size:var(--wa-f);font-weight:var(--wa-w-ctl);line-height:1.2;letter-spacing:var(--wa-letter-sp);
  text-align:center;text-decoration:none;cursor:pointer;user-select:none;-webkit-tap-highlight-color:transparent;
  background:var(--wa-tonal);color:var(--wa-ink);box-shadow:inset 0 0 0 var(--wa-edge) var(--wa-edge-color);
  transition:background-color .18s ease,color .18s ease,box-shadow .18s ease,opacity .18s ease}
${s}.wa-btn:hover{background:var(--wa-hover)}
${s}.wa-btn:active{background:var(--wa-press)}
${s}.wa-btn svg{flex:none;width:1em;height:1em}
${s}.wa-btn[disabled],${s}.wa-btn[aria-disabled=true]{cursor:not-allowed;color:var(--wa-ink-2);background:var(--wa-tonal)}
${s}.wa-btn--quiet{background:transparent;box-shadow:none}
${s}.wa-btn--quiet:hover{background:var(--wa-tonal)}
${s}.wa-btn--tonal{background:var(--wa-tonal);color:var(--wa-ink)}
${s}.wa-btn--accent{background:var(--wa-accent);color:var(--wa-on-accent);box-shadow:none}
${s}.wa-btn--accent:hover{background:var(--wa-accent-hover)}
${s}.wa-btn--soft{background:var(--wa-accent-tint);color:var(--wa-accent);box-shadow:inset 0 0 0 var(--wa-edge) var(--wa-edge-color)}
${s}.wa-btn--soft:hover{background:color-mix(in srgb,var(--wa-accent-tint) 70%,var(--wa-accent) 12%)}
${s}.wa-btn--ink{background:var(--wa-ink);color:var(--wa-canvas);box-shadow:none}
${s}.wa-btn--ink:hover{background:color-mix(in srgb,var(--wa-ink) 86%,var(--wa-canvas))}
${s}.wa-btn--action{background:var(--wa-action);color:var(--wa-on-action);box-shadow:none}
${s}.wa-btn--action:hover{background:var(--wa-action-hover)}
${s}.wa-btn--link{background:transparent;box-shadow:none;color:var(--wa-link);padding-inline:2px;min-width:0;justify-content:flex-start;text-align:left}
${s}.wa-btn--link:hover{background:transparent;text-decoration:underline;text-underline-offset:.18em}
${s}.wa-btn--block{width:100%}
${s}.wa-card{background:var(--wa-raised);border-radius:var(--wa-r-card);padding:var(--wa-card-pad);
  box-shadow:var(--wa-shadow-card),inset 0 0 0 var(--wa-edge) var(--wa-edge-color)}
${s}.wa-dot{flex:none;display:inline-block;width:10px;height:10px;border-radius:50%;background:var(--wa-accent)}
${s}.wa-meta{color:var(--wa-ink-2)}
${s}.wa-sr{position:absolute!important;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);white-space:nowrap;border:0}
${s}:focus-visible{outline:var(--wa-ring) solid var(--wa-focus);outline-offset:var(--wa-ring)}
`;
}

const RESET = `
:host{all:initial;color-scheme:light}
:host *,:host *::before,:host *::after{box-sizing:border-box}
[popover]{margin:0;padding:0;border:0;max-width:none;max-height:none;background:transparent;color:inherit;overflow:visible}
`;

export const baseCss: string = `${RESET}${tokensToCss(tokensFor(null, 'light'), ':host')}${primitives('')}`;

/**
 * For the chrome's own shadow root: while the Calm view is open, the WebAble pill and the floating chips step aside
 * (the view has its own Close and Original page). The App sets `data-calm-open` on `.wa-root`; the rule on the open
 * Calm host works even before it does.
 */
export const calmChromeCss: string = `
.wa-root[data-calm-open] .wa-floatchip,:host([data-calm-open]) .wa-floatchip,
.wa-calm-host.is-open.has-content ~ .wa-app .wa-floatchip{display:none!important}
`;

const C = '.wa-calm';
/** A band that holds only a folded part or one row (end matter that stacks into one list). */
const END = ':is(.wa-band,.wa-isec):is(:has(>.wa-disc:only-child),:has(>.wa-rows:only-child>.wa-row:only-child))';

/*
 * Calm view v3 (design.md §2): the AI-lab research-site language. A white page with no boxed cards; one family at
 * 400 / 500; a narrow text column (--wa-text-col) inside a picture column 1.45 × as wide (--wa-wide-col), always one
 * reading column; hairline dividers instead of card edges; ink pill buttons; ink links underlined at .2em; pictures
 * with a small radius in reserved boxes; meta never under 16 px. Forms keep a min(36em, 100%) column with labels
 * above fields. Everything is sized from the fit's tokens.
 */
export const calmCss: string = `
${C}{position:fixed;inset:0;z-index:2;display:block;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;
  scroll-padding-top:calc(var(--wa-strip-h) + 16px);scroll-padding-bottom:calc(var(--wa-dock-h) + 24px);
  background:var(--wa-canvas);color:var(--wa-ink);pointer-events:auto;text-align:left;
  font-family:var(--wa-font);font-size:var(--wa-f);line-height:var(--wa-lh-body);font-weight:var(--wa-w-body);
  word-spacing:var(--wa-word-sp);letter-spacing:var(--wa-letter-sp);
  -webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;font-kerning:normal;
  color-scheme:light;container-type:inline-size;container-name:wa}
${C}[data-scheme=dark]{color-scheme:dark}
${C} *,${C} *::before,${C} *::after{box-sizing:border-box}
${C} :where(h1,h2,h3,h4,h5,h6,p,ul,ol,li,figure,figcaption,blockquote,dl,dt,dd,table,fieldset,legend){margin:0;padding:0;border:0;font:inherit;color:inherit}
${C} :where(ul,ol){list-style:none}
${C} :where(button,input,select,textarea){font:inherit;color:inherit;letter-spacing:inherit;word-spacing:inherit;margin:0}
${C} :where(img,svg,video){display:block;max-width:100%}
${C} :where(a){color:var(--wa-link);text-decoration:none}
${C} ::selection{background:var(--wa-selection)}
${primitives(`${C} `)}

/* ---------- v3 buttons: secondary = surface pill, primary = ink pill, links = ink ---------- */
${C} .wa-btn{background:var(--wa-tonal);color:var(--wa-ink);font-weight:var(--wa-w-ctl);box-shadow:inset 0 0 0 var(--wa-edge) var(--wa-edge-color)}
${C} .wa-btn:hover{background:var(--wa-hover)}
${C} .wa-btn--quiet{background:transparent;box-shadow:none}
${C} .wa-btn--quiet:hover{background:var(--wa-tonal)}
${C} .wa-btn--link{background:transparent;box-shadow:none;color:var(--wa-link);font-weight:var(--wa-w-body);padding-inline:0;min-width:0;gap:.35em;
  text-decoration:underline;text-decoration-thickness:max(1px,.06em);text-underline-offset:.2em}
${C} .wa-btn--link.wa-btn--block{width:auto;align-self:flex-start}
${C} .wa-btn--link:hover{background:transparent;text-decoration-thickness:max(2px,.1em)}
${C} .wa-btn--link svg{width:.8em;height:.8em;color:var(--wa-ink-2)}
${C} .wa-btn--soft{background:var(--wa-tonal);color:var(--wa-ink)}
${C} .wa-btn--soft:hover{background:var(--wa-hover)}
${C} .wa-btn[data-selected]{background:var(--wa-ink);color:var(--wa-canvas)}
${C} :focus-visible{outline:var(--wa-ring) solid var(--wa-focus);outline-offset:2px}

/* ---------- the top bar ----------
   Round 6: it never overlaps or clips. Controls are the fit's target size but at most 48 px tall (--wa-strip-ctl),
   labels 15–19 px (--wa-strip-f). Every item keeps its size (flex:none) except the site name, which shrinks to an
   ellipsis; Strip.tsx measures the bar and collapses it a step at a time when the last item would pass the edge. */
${C} .wa-strip{position:sticky;top:0;z-index:5;background:var(--wa-glass);
  -webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);
  box-shadow:0 var(--wa-hair) 0 var(--wa-line);font-size:var(--wa-strip-f);line-height:1.25}
${C} .wa-strip__in{max-width:var(--wa-page-max);margin:0 auto;min-height:var(--wa-strip-h);padding:8px var(--wa-side-pad);
  display:flex;flex-wrap:nowrap;align-items:center;gap:10px}
${C} .wa-brand{flex:0 1 auto;display:flex;align-items:center;gap:8px;min-width:5.5em;max-width:16ch;font-weight:var(--wa-w-head)}
${C} .wa-brand__name{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${C} .wa-brand .wa-logo{flex:none}
${C} .wa-strip__tools{flex:none;margin-left:auto;display:flex;align-items:center;flex-wrap:nowrap;justify-content:flex-end;gap:8px}
${C} .wa-strip .wa-btn{position:relative;flex:none;font-size:var(--wa-strip-f);min-height:var(--wa-strip-ctl);min-width:var(--wa-strip-ctl);
  padding-inline:max(12px,calc(var(--wa-strip-ctl)*.34));white-space:nowrap}
/* The hit area is the fit's full target size even where the drawn pill is capped at 48 px. */
${C} .wa-strip .wa-btn::after,${C} .wa-provchip::after{content:"";position:absolute;left:0;right:0;top:50%;height:max(100%,var(--wa-t));transform:translateY(-50%)}
${C} .wa-strip .wa-close{min-width:var(--wa-strip-ctl);width:var(--wa-strip-ctl);padding-inline:0;border-radius:50%}
${C} .wa-strip .wa-btn--quiet{box-shadow:inset 0 0 0 var(--wa-edge) var(--wa-edge-color)}
${C} .wa-strip .wa-btn--helplink{color:var(--wa-ink);padding-inline:10px;flex:0 1 auto;min-width:var(--wa-strip-ctl);max-width:100%;font-weight:var(--wa-w-body)}
${C} .wa-strip .wa-btn--helplink svg{color:var(--wa-ink-2)}
${C} .wa-strip__help{display:inline-flex;flex:none;max-width:14em;overflow:hidden}
${C} .wa-strip__help .wa-btn span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${C} .wa-seg{flex:none;display:inline-flex;align-items:center;padding:3px;gap:2px;border-radius:var(--wa-r-pill);background:var(--wa-tonal);
  box-shadow:inset 0 0 0 var(--wa-edge) var(--wa-edge-color)}
${C} .wa-seg .wa-btn{background:transparent;box-shadow:none;min-width:var(--wa-strip-ctl);min-height:calc(var(--wa-strip-ctl) - 6px);padding-inline:10px}
${C} .wa-seg .wa-btn:hover{background:var(--wa-hover)}
/* "⋯": text size and help when the bar is short of room. */
${C} .wa-strip__more{position:relative;flex:none;display:inline-flex}
${C} .wa-strip .wa-strip__dots{width:var(--wa-strip-ctl);padding-inline:0;border-radius:50%;font-size:calc(var(--wa-strip-f)*1.3);line-height:1;font-weight:var(--wa-w-head)}
${C} .wa-menu{position:absolute;z-index:8;top:calc(100% + 10px);right:0;min-width:15em;display:flex;flex-direction:column;gap:6px;padding:12px 16px;
  border-radius:14px;background:var(--wa-raised);color:var(--wa-ink);box-shadow:var(--wa-shadow-float),inset 0 0 0 1px var(--wa-line);animation:wa-in .16s ease-out both}
${C} .wa-menu__row{display:flex;align-items:center;justify-content:space-between;gap:16px;white-space:nowrap}
${C} .wa-menu__help{justify-content:flex-start;box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line);padding-top:6px}
${C} .wa-menu .wa-btn--helplink{text-decoration:underline;text-underline-offset:.2em;padding-inline:0}
/* "New layout ready · Use it": one slim line under the bar, never inside it. */
${C} .wa-strip__note{box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line);background:var(--wa-accent-tint)}
${C} .wa-strip__notein{max-width:var(--wa-page-max);margin:0 auto;padding:0 var(--wa-side-pad);display:flex;align-items:center;gap:10px;
  min-height:calc(var(--wa-strip-ctl) - 4px);color:var(--wa-ink);font-weight:var(--wa-w-body);white-space:nowrap;overflow:hidden;animation:wa-in .25s ease-out both}
${C} .wa-strip__notein>svg{flex:none;width:1em;height:1em;color:var(--wa-accent)}
${C} .wa-strip__notetext{min-width:0;overflow:hidden;text-overflow:ellipsis}
${C} .wa-strip .wa-strip__use{min-height:calc(var(--wa-strip-ctl) - 8px);min-width:0;padding-inline:4px;font-weight:var(--wa-w-ctl)}

/* ---------- provenance chip and popover ---------- */
${C} .wa-prov{flex:none;position:relative;display:flex;align-items:center;gap:10px;min-width:0}
${C} .wa-provchip{appearance:none;border:0;margin:0;position:relative;display:inline-flex;align-items:center;gap:8px;cursor:pointer;
  min-height:var(--wa-strip-ctl);padding:0 max(12px,calc(var(--wa-strip-ctl)*.3));border-radius:var(--wa-r-pill);
  background:var(--wa-tonal);color:var(--wa-ink-2);font:inherit;font-weight:var(--wa-w-body);white-space:nowrap;
  box-shadow:inset 0 0 0 var(--wa-edge) var(--wa-edge-color);transition:background-color .18s ease}
${C} .wa-provchip:hover{background:var(--wa-hover);color:var(--wa-ink)}
${C} .wa-provchip__dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--wa-accent)}
${C} .wa-provchip[data-loading] .wa-provchip__dot{animation:wa-pulse 1.4s ease-in-out infinite}
${C} .wa-provchip__src{display:inline-block;animation:wa-swap .2s ease-out both}
${C} .wa-popover{position:absolute;z-index:8;top:calc(100% + 10px);left:0;width:min(440px,calc(var(--wa-vw,100vw) - 32px));
  display:flex;flex-direction:column;gap:16px;padding:22px 24px;border-radius:16px;background:var(--wa-raised);color:var(--wa-ink);font-size:var(--wa-f);
  font-weight:var(--wa-w-body);white-space:normal;line-height:1.45;box-shadow:var(--wa-shadow-float),inset 0 0 0 1px var(--wa-line);
  animation:wa-in .18s ease-out both}
${C} .wa-popover:focus{outline:none}
${C} .wa-popover__title{font-weight:var(--wa-w-head)}
${C} .wa-popover__row{display:flex;align-items:center;justify-content:space-between;gap:12px 16px;flex-wrap:wrap}
${C} .wa-popover__row p{flex:1 1 14em}
${C} .wa-pbar{display:flex;flex-direction:column;gap:6px}
${C} .wa-pbar__row{display:flex;justify-content:space-between;gap:12px}
${C} .wa-pbar__row b{font-weight:var(--wa-w-head);font-variant-numeric:tabular-nums;white-space:nowrap}
${C} .wa-pbar__track{display:block;height:6px;border-radius:3px;background:var(--wa-tonal);overflow:hidden}
${C} .wa-pbar__fill{display:block;height:100%;border-radius:3px;background:var(--wa-ink)}
${C} .wa-pbar[data-tone=risk] .wa-pbar__fill{background:var(--wa-warning)}

/* ---------- the page: a text column inside a picture column ---------- */
${C} .wa-page{display:block;padding:var(--wa-top-pad) var(--wa-gutter) calc(var(--wa-band-gap)*1.25)}
${C}[data-docked] .wa-page{min-height:calc(var(--wa-vh,100vh) - var(--wa-strip-h) - var(--wa-dock-h))}
${C} .wa-page:focus{outline:none}
${C} .wa-col{max-width:var(--wa-wide-col);margin:0 auto}
${C} .wa-col>*{max-width:min(var(--wa-text-col),100%);margin-inline:auto}
${C} .wa-col[data-kind=form]>*{max-width:min(var(--wa-form-col),100%)}
${C} .wa-col>.wa-wide{max-width:none}
${C} .wa-stack{display:flex;flex-direction:column;gap:var(--wa-gap)}
${C} .wa-stack>*{min-width:0}
${C} :is(.wa-stack,.wa-frame,.wa-form,.wa-stepbody,.wa-group,.wa-sub,.wa-disc__body,.wa-buy__info,.wa-prose,.wa-help__body,.wa-popup,.wa-result,.wa-tile,.wa-para)>.wa-btn:not(.wa-btn--block){align-self:flex-start}
${C} .wa-band{margin-top:var(--wa-band-gap)}
${C} .wa-band--tight{margin-top:var(--wa-card-gap)}
${C} .wa-band--first{margin-top:0;margin-bottom:var(--wa-task-gap)}
${C} .wa-band--task{margin-top:var(--wa-card-gap)}
${C} :is(.wa-lead,.wa-art)+:is(.wa-band,.wa-band--tight,.wa-band--task){margin-top:0}
${C} .wa-head{display:flex;flex-wrap:wrap;align-items:baseline;gap:0 .4em;margin-bottom:var(--wa-h2-below)}
${C} .wa-panel{background:transparent;padding:0;border-radius:0;box-shadow:none}
${C} :is(.wa-panel,.wa-band,.wa-result,.wa-disc,.wa-notice,.wa-story,.wa-isec){scroll-margin-top:calc(var(--wa-strip-h) + 20px);scroll-margin-bottom:calc(var(--wa-dock-h) + 24px)}

/* ---------- type ---------- */
/* The page title: at most 2 × the body (tokens) and under 5.5 % of the window, never below 1.25 × the body. */
${C} .wa-h-page{font-family:var(--wa-font-display);font-size:max(calc(var(--wa-f)*1.25),min(var(--wa-f-page),calc(var(--wa-vw,100vw)*.055)));line-height:var(--wa-lh-page);font-weight:var(--wa-w-head);
  letter-spacing:var(--wa-tr-page);text-wrap:balance;overflow-wrap:break-word}
${C} .wa-h-section{font-family:var(--wa-font-display);font-size:var(--wa-f-section);line-height:var(--wa-lh-section);font-weight:var(--wa-w-head);
  letter-spacing:var(--wa-tr-section);text-wrap:balance;overflow-wrap:break-word}
${C} .wa-h-title{font-family:var(--wa-font-display);font-size:var(--wa-f-title);line-height:var(--wa-lh-title);font-weight:var(--wa-w-head);
  letter-spacing:var(--wa-tr-title);overflow-wrap:break-word;text-wrap:pretty}
${C} .wa-count{color:var(--wa-ink-2);font-weight:var(--wa-w-body)}
${C} .wa-eyebrow{color:var(--wa-ink-2);font-weight:var(--wa-w-ctl);font-size:var(--wa-f-meta);line-height:1.4;text-transform:none;letter-spacing:var(--wa-letter-sp)}
${C} .wa-meta{color:var(--wa-ink-2);font-size:var(--wa-f-meta);line-height:1.45}
${C} .wa-p{max-width:min(var(--wa-measure),100%);overflow-wrap:break-word;text-wrap:pretty}
${C} .wa-p--quiet{color:var(--wa-ink-2)}
${C} .wa-p--price{font-weight:var(--wa-w-ctl);font-variant-numeric:tabular-nums}
${C} .wa-para{display:flex;flex-direction:column;gap:calc(var(--wa-para-gap)*.6)}
${C} .wa-inline-link{color:var(--wa-link);text-decoration:underline;text-decoration-thickness:max(1px,.06em);text-underline-offset:.2em;cursor:pointer}
${C} .wa-inline-link:hover{text-decoration-thickness:max(2px,.1em)}
${C} .wa-crumbs{color:var(--wa-ink-2);font-size:var(--wa-f-meta)}
${C} .wa-crumbs .wa-inline-link{color:inherit;text-decoration:none}
${C} .wa-crumbs .wa-inline-link:hover{text-decoration:underline}
${C} button.wa-inline-link{appearance:none;background:none;border:0;padding:0;font:inherit;display:inline;text-align:inherit;color:var(--wa-link)}
${C} .wa-list{display:flex;flex-direction:column;gap:calc(var(--wa-para-gap)*.4);padding-left:1.25em;list-style:disc outside}
${C} .wa-list--ol{list-style:decimal outside}
${C} .wa-list>li{padding-left:.25em;display:list-item}
${C} .wa-list>li::marker{color:var(--wa-ink-2)}
${C} .wa-list--plain{list-style:none;padding-left:0}
${C} .wa-actions{display:flex;flex-wrap:wrap;align-items:center;gap:10px 24px}
${C} .wa-equal{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,11.5em),1fr));gap:12px}
${C} .wa-equal .wa-btn{width:100%}

/* ---------- the first band: eyebrow, title, orientation ---------- */
${C} .wa-lead{display:flex;flex-direction:column;margin-bottom:var(--wa-task-gap)}
${C} .wa-lead .wa-h-page,${C} .wa-lead .wa-h-section{max-width:100%}
${C} .wa-lead__eyebrow{margin-bottom:calc(var(--wa-lead-gap)*.8)}
${C} .wa-orient{margin-top:var(--wa-lead-gap);max-width:min(var(--wa-measure),100%);font-size:var(--wa-f);line-height:var(--wa-lh-body);color:var(--wa-ink-2)}
${C} .wa-orient__line{color:var(--wa-ink-2)}
${C} .wa-orient__pin{color:var(--wa-ink);font-weight:var(--wa-w-ctl)}
${C} .wa-about{appearance:none;border:0;background:transparent;font:inherit;font-size:var(--wa-f);color:var(--wa-ink);cursor:pointer;white-space:nowrap;
  display:inline-flex;align-items:center;gap:.3em;padding:.35em .2em;margin:-.35em 0;border-radius:8px;font-weight:var(--wa-w-ctl);
  text-decoration:underline;text-decoration-thickness:max(1px,.06em);text-underline-offset:.2em}
${C} .wa-about__chev{width:.85em;height:.85em;transition:transform .2s ease}
${C} .wa-about[aria-expanded=true] .wa-about__chev{transform:rotate(180deg)}
${C} .wa-aboutwell{display:flex;flex-direction:column;gap:.7em;margin-top:14px;padding:var(--wa-card-pad) 0 0;font-size:var(--wa-f);color:var(--wa-ink);
  box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line)}

/* ---------- article header: kicker · date, title, dek, byline, lead picture ---------- */
${C} .wa-art{display:flex;flex-direction:column;margin-bottom:var(--wa-task-gap)}
${C} .wa-art__meta{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px .55em;margin-bottom:calc(var(--wa-lead-gap)*1.4)}
${C} .wa-art__meta .wa-sep{color:var(--wa-line-strong)}
${C} .wa-art__kicker{color:var(--wa-ink);font-weight:var(--wa-w-ctl)}
${C} .wa-art__dek{margin-top:calc(var(--wa-lead-gap)*1.6);font-size:var(--wa-f-title);line-height:1.45;color:var(--wa-ink-2);max-width:min(var(--wa-measure),100%)}
${C} .wa-art__byline{margin-top:calc(var(--wa-lead-gap)*1.6);display:flex;flex-wrap:wrap;gap:2px .55em;align-items:baseline}
${C} .wa-art__byline .wa-inline-link{color:var(--wa-ink);text-decoration-color:var(--wa-line-strong)}
${C} .wa-art__names{color:var(--wa-ink);font-size:var(--wa-f-meta)}
${C} .wa-art__lead{margin-top:calc(var(--wa-band-gap)*.6)}

/* ---------- pictures: reserved boxes, the source ratio or a 4:3 well, caption then credit ---------- */
${C} .wa-pic{display:flex;flex-direction:column;gap:10px;margin:0}
${C} .wa-pic__box{position:relative;width:100%;overflow:hidden;border-radius:var(--wa-r-pic);background:var(--wa-well);aspect-ratio:var(--wa-ratio,16/9)}
${C} .wa-pic__box>img{position:absolute;inset:0;width:100%;height:100%;max-width:none;object-fit:cover;opacity:0;transition:opacity .3s ease}
${C} .wa-pic__box[data-fit=contain]>img{object-fit:contain;padding:6%}
${C} .wa-pic__box[data-state=ok]>img{opacity:1}
${C} .wa-pic__cap{color:var(--wa-ink-2);font-size:var(--wa-f-meta);line-height:1.45;max-width:min(var(--wa-measure),100%)}
${C} .wa-pic__credit{color:var(--wa-ink-2);opacity:.85}
/* The picture column: 1.45 × the text column, never wider than the screen, and never so wide that the picture is
   taller than about three quarters of the screen (it then shrinks toward the text column). */
${C} .wa-pic--wide{--wa-wide-w:min(var(--wa-wide-col),calc(var(--wa-vw,100vw) - 2 * var(--wa-gutter) - 16px),
    max(var(--wa-text-col),calc((var(--wa-vh,100vh) - var(--wa-strip-h)) * .74 * var(--wa-ratio,1.5))));
  width:var(--wa-wide-w);max-width:none;margin-left:calc((100% - var(--wa-wide-w)) / 2)}
${C} .wa-pic--wide .wa-pic__cap{width:min(var(--wa-text-col),100%);max-width:none;margin-inline:auto;box-sizing:border-box;
  padding-inline-end:max(0px,calc(min(var(--wa-text-col),100%) - var(--wa-measure)))}
${C} .wa-pic--small{max-width:min(100%,24em)}
${C} .wa-figure{display:flex;flex-direction:column;gap:8px}
${C} .wa-figure img{border-radius:var(--wa-r-pic);max-height:min(calc(var(--wa-vh,100vh) * .62),560px);width:auto;object-fit:contain;background:var(--wa-well)}
${C} .wa-figure--icon img{max-height:96px;background:transparent}
${C} .wa-well{background:var(--wa-well);border-radius:var(--wa-r-pic);display:flex;align-items:center;justify-content:center;overflow:hidden;padding:7%}
${C} .wa-well img{display:block;width:100%;height:100%;min-width:0;min-height:0;object-fit:contain}
${C} .wa-well[data-fit=cover]{padding:0}
${C} .wa-well[data-fit=cover] img{width:100%;height:100%;max-width:none;max-height:none;object-fit:cover}
${C} .wa-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,calc(var(--wa-tile-min)*.8)),1fr));gap:var(--wa-card-gap)}
${C} .wa-gallery .wa-well{aspect-ratio:1/1}

/* ---------- news index: lead story, top stories, the page's sections ---------- */
${C} .wa-index{display:flex;flex-direction:column}
${C} .wa-leadstory{display:flex;flex-direction:column;gap:calc(var(--wa-lead-gap)*1.2);color:inherit;text-decoration:none}
${C} .wa-leadstory .wa-pic{margin-bottom:calc(var(--wa-lead-gap)*.8)}
${C} .wa-leadstory .wa-pic__box{width:min(100%,calc(var(--wa-vh,100vh) * .56 * 16 / 9))}
${C} .wa-leadstory__title{font-family:var(--wa-font-display);font-size:var(--wa-f-section);line-height:var(--wa-lh-section);font-weight:var(--wa-w-head);
  letter-spacing:var(--wa-tr-section);text-wrap:balance;overflow-wrap:break-word;color:var(--wa-ink)}
${C} a.wa-leadstory:hover .wa-leadstory__title{text-decoration:underline;text-decoration-thickness:max(1px,.05em);text-underline-offset:.15em}
${C} .wa-leadstory__dek{color:var(--wa-ink-2);font-size:var(--wa-f-title);line-height:1.45;max-width:min(var(--wa-measure),100%);
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
${C} .wa-kicker{color:var(--wa-ink);font-weight:var(--wa-w-ctl);font-size:var(--wa-f-meta);line-height:1.4}
${C} .wa-time{color:var(--wa-ink-2);font-size:var(--wa-f-meta);line-height:1.4;font-variant-numeric:tabular-nums}
${C} .wa-storyhead{margin:var(--wa-band-gap) 0 calc(var(--wa-h2-below)*.5)}
${C} .wa-stories{display:flex;flex-direction:column;box-shadow:0 var(--wa-hair) 0 var(--wa-line)}
${C} .wa-story{position:relative;display:grid;grid-template-columns:minmax(0,1fr) clamp(120px,28%,240px);align-items:start;gap:4px calc(var(--wa-f)*1.25);
  padding:var(--wa-row-pad) 0;color:inherit;text-decoration:none;box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line)}
${C} .wa-story--text{grid-template-columns:minmax(0,1fr)}
${C} .wa-story__text{display:flex;flex-direction:column;gap:6px;min-width:0}
${C} .wa-story__title{font-family:var(--wa-font-display);font-size:var(--wa-f-title);line-height:var(--wa-lh-title);font-weight:var(--wa-w-head);
  letter-spacing:var(--wa-tr-title);color:var(--wa-ink);overflow-wrap:break-word;text-wrap:pretty}
${C} a.wa-story:hover .wa-story__title{text-decoration:underline;text-decoration-thickness:max(1px,.06em);text-underline-offset:.18em}
${C} .wa-story__dek{color:var(--wa-ink-2);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
${C} .wa-story__thumb .wa-pic__box{aspect-ratio:16/9}
${C} .wa-story:focus-visible{outline-offset:4px}
@container wa (max-width: 36em){
  ${C} .wa-story{grid-template-columns:minmax(0,1fr)}
  ${C} .wa-story__thumb{order:-1;width:100%}
}
${C} .wa-isec{margin-top:var(--wa-band-gap)}
${C} .wa-isec>.wa-head{margin-bottom:calc(var(--wa-h2-below)*.5)}
${C} .wa-isec__more{margin-top:calc(var(--wa-card-gap)*.5)}

/* ---------- grouped rows: hairlines, no box ---------- */
${C} .wa-rows,${C} .wa-choices,${C} .wa-facts{background:transparent;border-radius:0;overflow:visible;box-shadow:inset 0 calc(var(--wa-hair) * -1) 0 var(--wa-line)}
${C} .wa-row,${C} .wa-choice,${C} .wa-fact{position:relative;display:flex;align-items:center;gap:calc(var(--wa-f)*1.1);min-height:var(--wa-row);
  padding:calc(var(--wa-row-pad)*.75) 0;color:var(--wa-ink);box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line)}
${C} a.wa-row,${C} button.wa-row{width:100%;text-align:left;border:0;background:transparent;cursor:pointer;font:inherit}
${C} a.wa-row:hover .wa-row__title,${C} button.wa-row:hover .wa-row__title{text-decoration:underline;text-decoration-thickness:max(1px,.06em);text-underline-offset:.2em}
${C} a.wa-row:hover .wa-row__chev,${C} button.wa-row:hover .wa-row__chev{transform:translateX(3px);color:var(--wa-ink)}
${C} :is(.wa-rows,.wa-facts,.wa-table-wrap,.wa-stories) :focus-visible{outline-offset:-2px}
${C} .wa-row__main{flex:1;min-width:0;display:flex;flex-direction:column;gap:3px}
${C} .wa-row__title{font-weight:var(--wa-w-ctl);overflow-wrap:break-word;color:var(--wa-ink)}
${C} .wa-row__chev{flex:none;width:.9em;height:.9em;color:var(--wa-ink-2);transition:transform .18s ease}
${C} .wa-row__icon{flex:none;display:grid;place-items:center;width:2em;height:2em;border-radius:50%;background:var(--wa-tonal);color:var(--wa-ink)}
${C} .wa-row__icon svg{width:55%;height:55%}
${C} .wa-row__thumb{flex:none;order:2;width:clamp(96px,22%,200px);aspect-ratio:16/9;border-radius:var(--wa-r-pic);padding:0}
${C} .wa-row__thumb[data-fit=contain]{aspect-ratio:4/3;padding:6px}
${C} .wa-row__aside{flex:none;display:flex;gap:8px;align-items:center}
${C} .wa-groupgap{display:flex;flex-direction:column;gap:var(--wa-card-gap)}

/* ---------- choices (checkbox and radio) ---------- */
${C} .wa-choice{cursor:pointer;align-items:flex-start;transition:background-color .18s ease}
${C} .wa-choice[data-disabled]{cursor:not-allowed}
${C} .wa-choice[data-disabled] .wa-choice__title{color:var(--wa-ink-2)}
${C} .wa-choice:has(input:focus-visible){outline:var(--wa-ring) solid var(--wa-focus);outline-offset:2px;z-index:1}
${C} .wa-box{flex:none;margin-top:calc((1em * var(--wa-lh-body) - var(--wa-check)) / 2);width:var(--wa-check);height:var(--wa-check);
  border-radius:calc(var(--wa-check)*.24);display:grid;place-items:center;
  background:var(--wa-raised);box-shadow:inset 0 0 0 2px var(--wa-line-strong);color:var(--wa-on-action);
  transition:background-color .18s ease,box-shadow .18s ease}
${C} .wa-box--radio{border-radius:50%}
${C} .wa-box svg{width:64%;height:64%;opacity:0;transition:opacity .12s ease}
${C} .wa-box__dot{width:40%;height:40%;border-radius:50%;background:var(--wa-on-action);opacity:0}
${C} .wa-choice[data-checked] .wa-box{background:var(--wa-action);box-shadow:none}
${C} .wa-choice[data-checked] .wa-box svg,${C} .wa-choice[data-checked] .wa-box__dot{opacity:1}
${C} .wa-choice[data-disabled] .wa-box{background:var(--wa-tonal);box-shadow:inset 0 0 0 2px var(--wa-line)}
${C} .wa-choice__text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
${C} .wa-choice__title{font-weight:var(--wa-w-ctl);overflow-wrap:break-word}
${C} .wa-choice__meta{color:var(--wa-ink-2);overflow-wrap:break-word}
${C} .wa-choice__extra{display:flex;flex-wrap:wrap;gap:4px 20px;padding:0 0 12px calc(var(--wa-check) + var(--wa-f)*1.1)}

/* ---------- fields and forms: one column, labels above fields ---------- */
${C} .wa-field{display:flex;flex-direction:column;gap:8px}
${C} .wa-label{font-weight:var(--wa-w-ctl)}
${C} .wa-req{color:var(--wa-ink-2);font-weight:var(--wa-w-body)}
${C} .wa-hint{color:var(--wa-ink-2);font-size:var(--wa-f-meta)}
${C} .wa-input{width:100%;min-height:var(--wa-ctl);padding:0 var(--wa-field-pad);border-radius:var(--wa-r-field);
  background:var(--wa-raised);color:var(--wa-ink);border:var(--wa-ctl-edge) solid var(--wa-line-strong);
  transition:border-color .18s ease,box-shadow .18s ease}
${C} .wa-input:hover{border-color:var(--wa-ink-2)}
${C} .wa-input--10{max-width:calc(10ch + 2 * var(--wa-field-pad) + 4px)}
${C} .wa-input--20{max-width:calc(20ch + 2 * var(--wa-field-pad) + 4px)}
${C} .wa-input--30{max-width:calc(30ch + 2 * var(--wa-field-pad) + 4px)}
${C} textarea.wa-input{padding-block:calc(var(--wa-field-pad)*.7);min-height:calc(var(--wa-ctl)*2.4);resize:vertical;line-height:var(--wa-lh-body)}
${C} .wa-input:focus{outline:none;border-color:var(--wa-ink);box-shadow:0 0 0 var(--wa-ring) color-mix(in srgb,var(--wa-ink) 22%,transparent)}
${C} .wa-input[disabled],${C} .wa-input[readonly]{background:var(--wa-tonal);color:var(--wa-ink-2)}
${C} .wa-input[aria-invalid=true]{border-color:var(--wa-warning)}
${C} .wa-selectwrap{position:relative;display:flex;align-items:center}
${C} .wa-selectwrap select{appearance:none;-webkit-appearance:none;padding-right:calc(var(--wa-field-pad)*2 + 1em);cursor:pointer}
${C} .wa-selectwrap svg{position:absolute;right:var(--wa-field-pad);width:1em;height:1em;color:var(--wa-ink-2);pointer-events:none}
${C} .wa-group{display:flex;flex-direction:column;gap:var(--wa-gap)}
${C} .wa-form{display:flex;flex-direction:column;gap:var(--wa-field-gap)}
${C} .wa-form__title{margin-bottom:calc(var(--wa-field-gap) * -.4)}
${C} .wa-formstack{gap:calc(var(--wa-f)*2.5)}
${C} .wa-formnote{gap:calc(var(--wa-gap)*.8)}
${C} .wa-formnote .wa-p{color:var(--wa-ink-2)}

/* ---------- stepped form ---------- */
${C} .wa-steppanel{display:flex;flex-direction:column;gap:6px}
${C} .wa-steppanel:focus{outline:none}
${C} .wa-stepof{margin:0}
${C} .wa-step__title{margin-bottom:calc(var(--wa-field-gap)*.6)}
${C} .wa-stepbody{display:flex;flex-direction:column;gap:var(--wa-field-gap)}
${C} .wa-summary{display:flex;flex-direction:column;gap:12px}
${C} .wa-summary .wa-rows{margin:0}
${C} .wa-sumrow{position:relative;display:grid;grid-template-columns:minmax(8em,2fr) 3fr auto;align-items:center;gap:4px 20px;min-height:var(--wa-row);
  padding:10px 0;box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line)}
${C} .wa-sumrow__k{color:var(--wa-ink-2)}
${C} .wa-sumrow__v{font-weight:var(--wa-w-ctl);overflow-wrap:anywhere}
${C} .wa-sumrow__a .wa-btn{min-height:max(44px,calc(var(--wa-t)*.8))}
@container wa (max-width: 640px){
  ${C} .wa-sumrow{grid-template-columns:1fr auto}
  ${C} .wa-sumrow__k{grid-column:1 / -1}
}

/* ---------- tiles: a picture over its words, no card ---------- */
${C} .wa-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,var(--wa-tile-min)),1fr));gap:calc(var(--wa-card-gap)*1.6) var(--wa-card-gap)}
${C} .wa-tile{display:flex;flex-direction:column;gap:6px;min-width:0;background:transparent;padding:0;border-radius:0;box-shadow:none}
${C} .wa-tile .wa-well{aspect-ratio:16/9;margin:0 0 8px}
${C} .wa-tile .wa-well[data-fit=contain]{aspect-ratio:4/3}
${C} .wa-tile__eyebrow{color:var(--wa-ink-2);font-weight:var(--wa-w-ctl);font-size:var(--wa-f-meta)}
${C} .wa-tile__title{font-family:var(--wa-font-display);font-size:var(--wa-f-title);line-height:var(--wa-lh-title);font-weight:var(--wa-w-head);
  letter-spacing:var(--wa-tr-title);overflow-wrap:break-word}
${C} .wa-tile__title a{color:inherit}
${C} .wa-tile__title a:hover{text-decoration:underline;text-underline-offset:.18em}
${C} .wa-tile__actions{margin-top:auto;padding-top:12px;display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center}
${C} .wa-more{margin-top:var(--wa-card-gap)}

/* ---------- disclosures and the end drawer: hairlines, no box ---------- */
${C} .wa-disc{background:transparent;border-radius:0;box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line),inset 0 calc(var(--wa-hair) * -1) 0 var(--wa-line)}
${C} .wa-disc+.wa-disc,${C} .wa-band--tight+.wa-band--tight>.wa-disc{box-shadow:inset 0 calc(var(--wa-hair) * -1) 0 var(--wa-line)}
/* End matter (folded parts, the chat row) one after another reads as one list: one hairline between, no band gap. */
${C} ${END}+${END}{margin-top:0}
${C} ${END}+${END}>.wa-disc{box-shadow:inset 0 calc(var(--wa-hair) * -1) 0 var(--wa-line)}
${C} ${END}+${END}>.wa-rows>.wa-row{box-shadow:none}
${C} ${END}+.wa-foot{box-shadow:none;margin-top:calc(var(--wa-band-gap)*.5)}
/* A help card holds its rows without hairlines of their own. */
${C} .wa-help :is(.wa-rows,.wa-row){box-shadow:none}
${C} .wa-help .wa-row{min-height:0;padding-block:4px}
${C} .wa-disc__sum{appearance:none;border:0;background:transparent;width:100%;display:flex;align-items:center;gap:14px;min-height:var(--wa-row);
  padding:calc(var(--wa-row-pad)*.7) 0;text-align:left;cursor:pointer;color:inherit;font:inherit}
${C} .wa-disc__sum:hover .wa-chev{background:var(--wa-hover)}
${C} .wa-disc__sum:hover .wa-disc__title{text-decoration:underline;text-decoration-thickness:max(1px,.06em);text-underline-offset:.2em}
${C} .wa-disc__text{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
${C} .wa-disc__title{font-family:var(--wa-font-display);font-size:var(--wa-f-title);line-height:var(--wa-lh-title);font-weight:var(--wa-w-head);letter-spacing:var(--wa-tr-title)}
${C} .wa-disc__sub{color:var(--wa-ink-2);font-size:var(--wa-f-meta)}
${C} .wa-chipcount{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:2em;min-height:1.7em;padding:0 .6em;
  border-radius:var(--wa-r-pill);background:var(--wa-tonal);color:var(--wa-ink-2);font-size:var(--wa-f-meta);font-weight:var(--wa-w-ctl);font-variant-numeric:tabular-nums}
${C} .wa-chev{flex:none;display:grid;place-items:center;width:max(36px,calc(var(--wa-f)*1.8));height:max(36px,calc(var(--wa-f)*1.8));border-radius:50%;
  background:var(--wa-tonal);color:var(--wa-ink);transition:transform .25s ease,background-color .18s ease}
${C} .wa-chev svg{width:46%;height:46%}
${C} .wa-disc[data-open] .wa-chev{transform:rotate(180deg)}
${C} .wa-disc__body{padding:4px 0 var(--wa-card-pad);display:flex;flex-direction:column;gap:var(--wa-card-gap)}
${C} .wa-disc .wa-disc{box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line)}
${C} .wa-sub{display:flex;flex-direction:column;gap:var(--wa-gap)}
${C} .wa-sub+.wa-sub{padding-top:var(--wa-card-gap);box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line)}
${C} .wa-sub__head{display:flex;align-items:baseline;gap:.4em;flex-wrap:wrap}

/* ---------- the dock ---------- */
${C} .wa-dock{position:sticky;bottom:0;z-index:5;padding:12px var(--wa-side-pad) 14px;background:var(--wa-glass);
  -webkit-backdrop-filter:saturate(180%) blur(20px);backdrop-filter:saturate(180%) blur(20px);
  box-shadow:0 calc(var(--wa-hair) * -1) 0 var(--wa-line);animation:wa-dock .16s ease-out both}
${C} .wa-dock__in{max-width:min(var(--wa-wide-col),100%);margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:12px 20px}
${C} .wa-dock__ctx{flex:1 1 auto;min-width:0;color:var(--wa-ink-2);font-weight:var(--wa-w-ctl);overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
${C} .wa-dock__btns{flex:none;display:flex;align-items:center;gap:12px}
${C} .wa-dock .wa-primary{margin:0;position:relative;gap:0}
${C} .wa-dock .wa-primary__hint{position:absolute;right:0;bottom:calc(100% + 12px);width:max-content;max-width:min(420px,calc(var(--wa-vw,100vw) * .7));text-align:right;
  padding:8px 14px;border-radius:10px;background:var(--wa-raised);color:var(--wa-ink);box-shadow:var(--wa-shadow-float),inset 0 0 0 1px var(--wa-line)}
${C} .wa-dock .wa-primary__hint:empty{display:none}
${C} .wa-dock .wa-btn--primary,${C} .wa-dock .wa-btn--done{width:auto;min-width:280px;padding-inline:max(28px,calc(var(--wa-pill-pad)*1.4))}
${C} .wa-dock .wa-btn--back{min-height:var(--wa-primary-h)}
${C} .wa-btn--done{min-height:var(--wa-primary-h);background:var(--wa-success-tint)!important;color:var(--wa-success)!important;
  font-size:var(--wa-f-title);font-weight:var(--wa-w-head);cursor:default;box-shadow:none}
@container wa (max-width: 640px){
  ${C} .wa-dock__ctx{display:none}
  ${C} .wa-dock__btns{flex:1}
  ${C} .wa-dock .wa-btn--primary,${C} .wa-dock .wa-btn--done{min-width:0;flex:1}
}
${C} .wa-secondary{display:flex;flex-wrap:wrap;gap:10px 12px}

/* ---------- the primary action: the one ink pill ---------- */
${C} .wa-primary{display:flex;flex-direction:column;gap:10px;margin-top:var(--wa-gap)}
${C} .wa-btn--primary{width:100%;min-height:var(--wa-primary-h);background:var(--wa-action);color:var(--wa-on-action);
  font-size:var(--wa-f-title);font-weight:var(--wa-w-ctl);letter-spacing:var(--wa-tr-title);box-shadow:none}
${C} .wa-btn--primary:hover{background:var(--wa-action-hover)}
${C} .wa-btn--primary:active{background:var(--wa-action);filter:brightness(.92)}
${C} .wa-btn--primary[data-armed]{box-shadow:0 0 0 var(--wa-ring) var(--wa-canvas),0 0 0 calc(var(--wa-ring)*2) var(--wa-action)}
${C} .wa-btn--primary[disabled]{background:var(--wa-tonal);color:var(--wa-ink-2);box-shadow:none}
${C} .wa-btn--primary:focus-visible{outline-offset:3px}
${C} .wa-btn--continue{background:var(--wa-action);color:var(--wa-on-action)}
${C} .wa-btn--continue:hover{background:var(--wa-action-hover)}
${C} .wa-primary__hint{color:var(--wa-ink-2);text-align:center}

/* ---------- notices, success, help, peek ---------- */
${C} .wa-notice{position:relative;display:flex;gap:14px;align-items:flex-start;background:var(--wa-warning-tint);border-radius:12px;
  padding:var(--wa-card-pad);box-shadow:inset 0 0 0 var(--wa-edge) var(--wa-edge-color)}
${C} .wa-notice:focus{outline:none}
${C} .wa-notice--consent{background:var(--wa-tonal)}
${C} .wa-notice--error{box-shadow:inset 0 0 0 max(1px,var(--wa-edge)) color-mix(in srgb,var(--wa-warning) 45%,transparent)}
${C} .wa-notice__icon{flex:none;display:grid;place-items:center;width:1.4em;height:calc(1em * var(--wa-lh-body));color:var(--wa-warning)}
${C} .wa-notice--consent .wa-notice__icon{color:var(--wa-ink-2)}
${C} .wa-notice__icon svg{width:1.15em;height:1.15em}
${C} .wa-notice__body{flex:1;min-width:0;display:flex;flex-direction:column;gap:var(--wa-gap)}
${C} .wa-notice__title{font-family:var(--wa-font-display);font-size:var(--wa-f-title);line-height:var(--wa-lh-title);font-weight:var(--wa-w-head)}
${C} .wa-notice .wa-btn{background:var(--wa-raised);box-shadow:inset 0 0 0 1px var(--wa-line-strong)}
${C} .wa-notice .wa-btn:hover{background:var(--wa-canvas);box-shadow:inset 0 0 0 1px var(--wa-ink)}
${C} .wa-notice__link{appearance:none;border:0;background:transparent;padding:6px 0;margin:-6px 0;font:inherit;cursor:pointer;align-self:flex-start;
  display:inline-flex;align-items:center;gap:.35em;color:var(--wa-ink);font-weight:var(--wa-w-ctl);text-decoration:underline;text-underline-offset:.2em;
  min-height:max(44px,calc(var(--wa-t)*.8))}
${C} .wa-notice__link svg{width:.85em;height:.85em;flex:none}
${C} .wa-errlist{display:flex;flex-direction:column;gap:6px}
${C} .wa-success{display:flex;flex-direction:column;gap:var(--wa-gap);padding:var(--wa-panel-pad);border-radius:16px;background:var(--wa-success-tint);
  color:var(--wa-ink);box-shadow:inset 0 0 0 var(--wa-edge) var(--wa-edge-color);animation:wa-in .25s ease-out both}
${C} .wa-success__icon{display:grid;place-items:center;width:calc(var(--wa-f)*2.2);height:calc(var(--wa-f)*2.2);border-radius:50%;background:var(--wa-success);color:var(--wa-success-tint)}
${C} .wa-success__icon svg{width:60%;height:60%;stroke-width:2.4}
${C} .wa-success h2:focus{outline:none}
${C} .wa-success__ref{display:flex;align-items:center;flex-wrap:wrap;gap:12px 16px}
${C} .wa-success__refno{font-size:var(--wa-f-big);font-weight:var(--wa-w-head);font-variant-numeric:tabular-nums;letter-spacing:.02em}
${C} .wa-help{display:flex;flex-wrap:wrap;align-items:center;gap:6px 18px;background:var(--wa-tonal);border-radius:12px;
  padding:calc(var(--wa-card-pad)*.75) var(--wa-card-pad);box-shadow:inset 0 0 0 var(--wa-edge) var(--wa-edge-color)}
${C} .wa-help__icon{flex:none;display:grid;place-items:center;width:2em;height:2em;border-radius:50%;background:var(--wa-raised);color:var(--wa-ink)}
${C} .wa-help__icon svg{width:55%;height:55%}
${C} .wa-help__body{flex:1 1 16em;display:flex;flex-direction:column;gap:2px;min-width:0}
${C} .wa-portal__title{margin-bottom:calc(var(--wa-h2-below)*.5)}
${C} .wa-helpgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,18em),1fr));gap:var(--wa-card-gap) calc(var(--wa-card-gap)*1.5)}
${C} .wa-helptile{display:flex;flex-direction:column;gap:var(--wa-gap-s);padding:var(--wa-card-gap) 0 0;box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line)}
${C} .wa-helptile .wa-h-title{display:flex;align-items:center;gap:12px;margin-bottom:4px}
${C} .wa-helptile .wa-help__icon{width:1.6em;height:1.6em;background:var(--wa-tonal)}
${C} .wa-helptile .wa-list{gap:4px}
${C} .wa-peek{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:14px var(--wa-card-pad);border-radius:12px;
  background:var(--wa-tonal);box-shadow:inset 0 0 0 var(--wa-edge) var(--wa-edge-color)}
${C} .wa-peek .wa-help__icon{background:var(--wa-raised)}
${C} .wa-peek .wa-btn{background:var(--wa-raised);box-shadow:inset 0 0 0 1px var(--wa-line-strong)}
${C} .wa-peek__text{flex:1 1 14em;display:flex;flex-direction:column;gap:2px;min-width:0}
${C} .wa-table-wrap{overflow-x:auto;background:transparent;border-radius:0;box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line)}
${C} .wa-table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums}
${C} .wa-table :is(th,td){padding:12px 16px 12px 0;text-align:left;vertical-align:top;box-shadow:inset 0 calc(var(--wa-hair) * -1) 0 var(--wa-line)}
${C} .wa-table th{font-weight:var(--wa-w-ctl)}
${C} .wa-fact{display:grid;grid-template-columns:minmax(7em,2fr) 3fr;gap:4px 24px;align-items:baseline}
${C} .wa-fact__k{color:var(--wa-ink-2)}
${C} .wa-fact--one{display:block}
${C} .wa-fact--head{font-weight:var(--wa-w-ctl)}
${C} .wa-fact .wa-actions{gap:2px 14px}
${C} .wa-fact .wa-btn--link{min-height:max(36px,calc(var(--wa-t)*.7))}
@container wa (max-width: 640px){
  ${C} .wa-fact{grid-template-columns:1fr}
}
${C} .wa-chips{display:flex;flex-wrap:wrap;gap:10px}
${C} .wa-chip{min-height:max(40px,var(--wa-chip-h))}
${C} .wa-chip[data-selected]{background:var(--wa-ink);color:var(--wa-canvas)}
${C} .wa-linkgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,max(11em,190px)),1fr));gap:0 24px}
${C} .wa-linkgrid .wa-btn--link{color:var(--wa-link);text-decoration:none;min-height:max(44px,var(--wa-t))}
${C} .wa-linkgrid .wa-btn--link:hover{color:var(--wa-link);text-decoration:underline}

/* ---------- product: picture well with thumbnails, then the buy box ---------- */
${C} .wa-buy{display:grid;gap:var(--wa-card-gap) calc(var(--wa-card-gap)*2);align-items:start}
${C} .wa-buy__media{display:flex;flex-direction:column;gap:12px}
${C} .wa-buy__media .wa-well,${C} .wa-buy__media .wa-pic__box{aspect-ratio:1/1;border-radius:16px;max-height:calc(var(--wa-vh,100vh) * .5);margin-inline:auto;width:100%}
${C} .wa-buy__thumbs{display:flex;gap:10px;flex-wrap:wrap}
${C} .wa-buy__thumb{appearance:none;border:0;padding:4px;width:64px;height:64px;border-radius:10px;background:var(--wa-well);cursor:pointer;box-shadow:inset 0 0 0 1px transparent}
${C} .wa-buy__thumb[aria-pressed=true]{box-shadow:inset 0 0 0 2px var(--wa-ink)}
${C} .wa-buy__thumb img{width:100%;height:100%;object-fit:contain}
${C} .wa-buy__info{display:flex;flex-direction:column;gap:var(--wa-gap)}
${C} .wa-buy__price{font-size:var(--wa-f-big);font-weight:var(--wa-w-ctl);font-variant-numeric:tabular-nums}
${C} .wa-buy__opts{display:flex;flex-direction:column;gap:var(--wa-gap)}
${C} .wa-buy__opts .wa-choices{display:flex;flex-wrap:wrap;gap:10px;box-shadow:none}
${C} .wa-buy__opts .wa-choice{min-height:max(44px,calc(var(--wa-t)*1.1));padding:8px 18px;border-radius:var(--wa-r-pill);background:var(--wa-raised);
  box-shadow:inset 0 0 0 1px var(--wa-line-strong);align-items:center}
${C} .wa-buy__opts .wa-choice .wa-box{display:none}
${C} .wa-buy__opts .wa-choice[data-checked]{box-shadow:inset 0 0 0 2px var(--wa-ink)}
@container wa (min-width: 56em){
  ${C} .wa-buy:not(.wa-buy--nomedia){grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
  ${C} .wa-buy__media{position:sticky;top:calc(var(--wa-strip-h) + 20px)}
  ${C} .wa-buy__media .wa-well,${C} .wa-buy__media .wa-pic__box{max-height:none}
}

/* ---------- reading: running text in the text column ---------- */
${C} .wa-sheet{background:transparent;border-radius:0;padding:0;box-shadow:none}
${C} .wa-prose{display:flex;flex-direction:column;gap:var(--wa-para-gap);max-width:min(var(--wa-measure),100%)}
${C} .wa-prose>:is(.wa-h-title,.wa-h-section){margin-top:calc(var(--wa-h2-above) - var(--wa-para-gap));margin-bottom:calc(var(--wa-h2-below) - var(--wa-para-gap))}
${C} .wa-prose>.wa-h-title{margin-top:calc(var(--wa-h2-above)*.6 - var(--wa-para-gap))}
${C} .wa-prose>.wa-pic{margin-block:calc(var(--wa-para-gap)*.4)}
${C} .wa-byline{color:var(--wa-ink-2);font-size:var(--wa-f-meta)}
${C} .wa-tools{display:flex;flex-wrap:wrap;gap:4px 10px;position:relative;inset-inline-start:-10px}
${C} .wa-btn--tool{background:transparent;box-shadow:none;color:var(--wa-ink);padding-inline:10px;min-width:0;font-weight:var(--wa-w-body)}
${C} .wa-btn--tool svg{color:var(--wa-ink-2)}
${C} .wa-btn--tool:hover{background:var(--wa-tonal)}
${C} .wa-frame{display:flex;flex-direction:column;gap:var(--wa-gap);background:transparent;border-radius:0;padding:0;box-shadow:none}

/* ---------- the page's own top-bar controls, under the task ---------- */
${C} .wa-substrip{display:flex;flex-wrap:wrap;align-items:center;gap:8px 6px}
/* Its first link's text lines up with the column (the link's own padding sits outside it). */
${C} .wa-substrip:not(:has(.wa-search)){position:relative;inset-inline-start:-12px}
${C} .wa-substrip .wa-search{flex:1 1 14em;max-width:22em;margin-right:8px}
${C} .wa-substrip .wa-strip__item{max-width:16em}
${C} .wa-substrip .wa-strip__item .wa-btn{min-height:max(44px,var(--wa-t));padding-inline:12px;background:transparent;box-shadow:none;color:var(--wa-ink);max-width:100%;
  font-weight:var(--wa-w-body);text-decoration:underline;text-decoration-thickness:max(1px,.06em);text-underline-offset:.2em}
${C} .wa-substrip .wa-strip__item .wa-btn span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${C} .wa-substrip .wa-strip__item .wa-btn:hover{background:var(--wa-tonal)}
${C} .wa-substrip .wa-search .wa-btn{min-height:max(44px,var(--wa-t));padding-inline:16px}
${C} .wa-search{display:flex;align-items:center;gap:8px;min-width:12em}
${C} .wa-search__field{position:relative;flex:1;min-width:0;display:flex;align-items:center}
${C} .wa-search__field svg{position:absolute;left:16px;width:1em;height:1em;color:var(--wa-ink-2);pointer-events:none}
${C} .wa-search input{width:100%;min-height:max(44px,var(--wa-t));padding:0 16px 0 calc(16px + 1.6em);border:0;border-radius:var(--wa-r-pill);
  background:var(--wa-tonal);color:var(--wa-ink);box-shadow:inset 0 0 0 max(1px,var(--wa-edge)) var(--wa-edge-color)}
${C} .wa-search input:focus{outline:none;box-shadow:0 0 0 2px var(--wa-ink)}

/* ---------- links that hold a heading, and search results: text links, never pills or cards ---------- */
${C} .wa-headlink{appearance:none;border:0;background:transparent;padding:0;margin:0;cursor:pointer;align-self:flex-start;text-align:left;
  font-family:var(--wa-font-display);font-size:var(--wa-f-title);line-height:var(--wa-lh-title);font-weight:var(--wa-w-head);
  letter-spacing:var(--wa-tr-title);color:var(--wa-link);overflow-wrap:break-word;text-wrap:pretty;
  text-decoration:underline;text-decoration-thickness:max(1px,.05em);text-underline-offset:.18em}
${C} .wa-headlink:hover{text-decoration-thickness:max(2px,.09em)}
${C} .wa-chiplink{min-height:max(40px,var(--wa-chip-h))}
${C} .wa-results{display:flex;flex-direction:column;gap:calc(var(--wa-f)*1.6)}
${C} .wa-res{display:flex;flex-direction:column;gap:4px;min-width:0;max-width:min(var(--wa-measure),100%)}
${C} .wa-res__title{appearance:none;border:0;background:transparent;padding:0;margin:0;cursor:pointer;align-self:flex-start;text-align:left;
  font-family:var(--wa-font-display);font-size:var(--wa-f-title);line-height:var(--wa-lh-title);font-weight:var(--wa-w-ctl);
  color:var(--wa-link);overflow-wrap:break-word;text-wrap:pretty;
  text-decoration:underline;text-decoration-thickness:max(1px,.05em);text-underline-offset:.18em}
${C} .wa-res__title:hover{text-decoration-thickness:max(2px,.09em)}
${C} .wa-res__url{color:var(--wa-ink-2);font-size:var(--wa-f-meta);line-height:1.4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
${C} .wa-res__snip,${C} .wa-res .wa-p{color:var(--wa-ink);margin-top:2px}
/* A result's snippet that the page keeps outside the link sits right under it, not a band away. */
${C} .wa-results+.wa-p,${C} .wa-results+.wa-para{margin-top:calc(var(--wa-gap)*-.5)}

/* ---------- page results and page popups ---------- */
${C} .wa-result{display:flex;flex-direction:column;gap:var(--wa-gap);background:var(--wa-raised);border-radius:12px;padding:var(--wa-card-pad);
  box-shadow:inset 0 0 0 2px var(--wa-ink)}
${C} .wa-popup{position:fixed;z-index:6;left:50%;top:calc(var(--wa-strip-h) + 20px);transform:translateX(-50%);
  width:min(calc(100% - 2 * var(--wa-side-pad)),var(--wa-text-col));max-height:calc(100% - var(--wa-strip-h) - 40px);overflow:auto;
  background:var(--wa-raised);border-radius:16px;padding:var(--wa-panel-pad);display:flex;flex-direction:column;gap:var(--wa-gap);
  box-shadow:var(--wa-shadow-float),inset 0 0 0 1px var(--wa-line);animation:wa-in .2s ease-out both}
${C} .wa-popup__head{display:flex;align-items:center;justify-content:space-between;gap:12px}
${C} .wa-foot{margin-top:var(--wa-band-gap);padding-top:var(--wa-card-gap);box-shadow:inset 0 var(--wa-hair) 0 var(--wa-line);color:var(--wa-ink-2);
  font-size:var(--wa-f-meta);display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:12px 24px}
${C} .wa-foot .wa-btn{font-size:var(--wa-f)}
${C} .wa-empty{color:var(--wa-ink-2);text-align:center;padding:var(--wa-band-gap) 0}

/* ---------- dark: product shots stay in a light well ---------- */
${C}[data-scheme=dark] :is(.wa-buy__media,.wa-tile,.wa-gallery) .wa-well{background:#F5F5F7}

/* ---------- maximum contrast: no tints or glass; 2px edges; underlined links ---------- */
${C}[data-mode=max] :is(.wa-notice,.wa-success,.wa-help,.wa-peek,.wa-popover,.wa-result,.wa-popup){
  box-shadow:inset 0 0 0 2px var(--wa-ink)!important;background:var(--wa-raised)!important}
${C}[data-mode=max] :is(.wa-rows,.wa-choices,.wa-facts,.wa-disc,.wa-stories){box-shadow:inset 0 -2px 0 var(--wa-ink)}
${C}[data-mode=max] :is(.wa-row,.wa-choice,.wa-fact,.wa-story,.wa-sumrow){box-shadow:inset 0 2px 0 var(--wa-ink)}
${C}[data-mode=max] :is(.wa-strip,.wa-dock){background:var(--wa-canvas);-webkit-backdrop-filter:none;backdrop-filter:none}
${C}[data-mode=max] .wa-strip{box-shadow:0 2px 0 var(--wa-ink)}
${C}[data-mode=max] .wa-dock{box-shadow:0 -2px 0 var(--wa-ink)}
${C}[data-mode=max] :is(a,.wa-btn--link,.wa-inline-link,.wa-about,.wa-notice__link,.wa-row__title,.wa-story__title,.wa-leadstory__title){text-decoration:underline;text-underline-offset:.18em}
${C}[data-mode=max] :is(.wa-provchip,.wa-btn--soft,.wa-btn--tonal,.wa-btn--done,.wa-btn:not(.wa-btn--primary):not(.wa-btn--continue):not(.wa-btn--link):not(.wa-btn--quiet):not(.wa-btn--tool)){background:var(--wa-canvas)!important;color:var(--wa-ink)!important;box-shadow:inset 0 0 0 2px var(--wa-ink)!important}
${C}[data-mode=max] :focus-visible{outline:3px solid var(--wa-focus);outline-offset:3px}
${C}[data-mode=max] .wa-input{border-width:2px;border-color:var(--wa-ink)}
/* Pictures get no frame in any mode (round 6: a 2 px box around the lead picture read as an empty form field). */
${C}[data-mode=max] .wa-pic__box{background:transparent;box-shadow:none}
/* A story is one link: only its headline is underlined, not its kicker, dek and time. */
${C}[data-mode=max] :is(a.wa-story,a.wa-leadstory,a.wa-row){text-decoration:none}
${C}[data-mode=max] .wa-seg .wa-btn{box-shadow:none!important}

/* ---------- motion ---------- */
@keyframes wa-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
@keyframes wa-dock{from{transform:translateY(100%)}to{transform:none}}
@keyframes wa-swap{from{opacity:0}to{opacity:1}}
@keyframes wa-pulse{0%,100%{opacity:1}50%{opacity:.3}}
${C} .wa-fade{animation:wa-in .25s ease-out both}
${C} .wa-popup.wa-fade{animation:none}
@media (prefers-reduced-motion: reduce){
  ${C},${C} *{animation:none!important;transition:none!important;scroll-behavior:auto!important}
}
${C}[data-motion=reduce],${C}[data-motion=reduce] *{animation:none!important;transition:none!important;scroll-behavior:auto!important}
`;
