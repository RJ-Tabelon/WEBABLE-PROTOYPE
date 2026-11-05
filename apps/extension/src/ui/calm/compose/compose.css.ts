// Round 10: styles for the WebAble page's components (Composed.tsx). The visual bar is Caden's OpenAI screenshots:
// a white page, few boxes (hairline cards with a 20 px radius and no shadow, only where a card helps), thin line icons,
// one big number per tile, tables with no fills, lots of space, one accent (green, for checks and WebAble's own
// takeaway). Type comes from the person's tokens (--wa-f and its ramp), so it grows with their text size; spacing
// follows page.css.ts (24 between blocks, 16 inside). Narrow columns and large text reflow through the group's own
// container (em in a container query is the person's body size). A constructed stylesheet: never CSS url().
const X = '.wa-cx';

export const composeCss: string = `
${X}{--cx-gap:max(24px,1.4em);--cx-in:max(16px,.95em);--cx-pad:max(24px,1.4em);--cx-r:20px;
  --cx-hair:max(1px,var(--wa-edge,0px));--cx-line:var(--wa-line);--cx-ink2:var(--wa-ink-2);--cx-accent:var(--wa-rw,#17694A);
  --cx-quiet:#F4F2EE;--cx-meta:var(--wa-f-meta);--cx-lead:calc(var(--wa-f) * 1.06);--cx-title:var(--wa-f-title);
  --cx-big:calc(var(--wa-f-section) * 1.3);--cx-quote:calc(var(--wa-f) * 1.18);
  display:flex;flex-direction:column;gap:var(--cx-gap);min-width:0;max-width:100%;
  container-type:inline-size;container-name:wa-cx}
:is([data-scheme=dark],[data-mode=max]) ${X}{--cx-quiet:var(--wa-tonal)}
${X},${X} *,${X} *::before,${X} *::after{box-sizing:border-box}
${X} :is(h3,h4,p,ul,ol,li,dl,dt,dd,figure,figcaption,blockquote,table){margin:0;padding:0;border:0}
${X} :is(ul,ol){list-style:none}
${X} .wa-cx-block{min-width:0;max-width:100%}
${X} .wa-cx-ic{display:block;flex:none;color:var(--cx-ink2)}
${X} .wa-cx-ic[data-icon=circle-check]{color:var(--cx-accent)}
${X} .wa-cx-ic[data-icon=triangle-alert]{color:var(--wa-warning)}

/* A component's own heading: the icon at the title's size, then the title. */
${X} .wa-cx-head{display:flex;align-items:flex-start;gap:.5em;margin-bottom:var(--cx-in);font-family:var(--wa-font-display);
  font-size:var(--cx-title);line-height:1.3;font-weight:600;letter-spacing:var(--wa-tr-title);color:var(--wa-ink);overflow-wrap:break-word}
${X} .wa-cx-head__ic{width:1em;height:1em;margin-top:.15em}
${X} .wa-cx-head__t{min-width:0}

/* Prose: the page's own reading style (same classes, so size, column and zoom apply). */
${X} .wa-cx-prose{display:flex;flex-direction:column;gap:var(--wa-para-gap)}
${X} .wa-cx-lead{margin-bottom:var(--cx-in)}

/* Key facts and contact rows: label over value, a hairline between rows, as many columns as fit (the first row's
   hairline is clipped away, with a pixel to spare for fractional positions). */
${X} .wa-cx-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,15em),1fr));column-gap:var(--cx-gap);
  margin-top:calc(var(--cx-hair) * -2);clip-path:inset(calc(var(--cx-hair) * 2) -16px -16px -16px)}
${X} .wa-cx-fact{display:grid;grid-template-columns:minmax(0,1fr);align-content:start;column-gap:.75em;padding-block:var(--cx-in);
  border-top:var(--cx-hair) solid var(--cx-line);min-width:0}
${X} .wa-cx-fact[data-icon]{grid-template-columns:auto minmax(0,1fr)}
${X} .wa-cx-fact__ic{grid-row:1 / span 2;width:1.2em;height:1.2em;margin-top:.05em}
${X} .wa-cx-fact__label{font-size:var(--cx-meta);line-height:1.45;color:var(--cx-ink2);overflow-wrap:break-word}
${X} .wa-cx-fact__value{font-size:var(--cx-lead);line-height:1.55;font-weight:500;color:var(--wa-ink);overflow-wrap:break-word}
${X} .wa-cx-keyfacts[data-card],${X} .wa-cx-tile,${X} .wa-cx-callout{background:var(--wa-canvas);border:var(--cx-hair) solid var(--cx-line);
  border-radius:var(--cx-r)}
${X} .wa-cx-keyfacts[data-card]{padding:var(--cx-pad) var(--cx-pad) calc(var(--cx-pad) - var(--cx-in))}

/* Steps: a number in a quiet circle, the step's title, its detail; a hairline joins the circles. */
${X} .wa-cx-steplist{--cx-dot:calc(var(--cx-lead) * 2.2);display:flex;flex-direction:column}
${X} .wa-cx-step{position:relative;display:grid;grid-template-columns:var(--cx-dot) minmax(0,1fr);column-gap:var(--cx-in);
  padding-bottom:var(--cx-gap)}
${X} .wa-cx-step:last-child{padding-bottom:0}
${X} .wa-cx-step:not(:last-child)::before{content:"";position:absolute;left:calc(var(--cx-dot) / 2 - .5px);
  top:calc(var(--cx-dot) + 6px);bottom:6px;width:1px;background:var(--cx-line)}
${X} .wa-cx-step__n{display:flex;align-items:center;justify-content:center;width:var(--cx-dot);height:var(--cx-dot);border-radius:50%;
  background:var(--cx-quiet);color:var(--wa-ink);font-size:var(--cx-lead);font-weight:600;line-height:1;font-variant-numeric:tabular-nums}
${X} .wa-cx-step__body{min-width:0;padding-top:calc((var(--cx-dot) - 1.45 * var(--cx-lead)) / 2)}
${X} .wa-cx-step__title{font-size:var(--cx-lead);line-height:1.45;font-weight:600;overflow-wrap:break-word}
${X} .wa-cx-step__detail{margin-top:4px;color:var(--cx-ink2);overflow-wrap:break-word}

/* Number tiles: label top left, icon top right, the value big, its note under it. Two to four across. */
${X} .wa-cx-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,12em),1fr));gap:var(--cx-in)}
${X} .wa-cx-tile{display:flex;flex-direction:column;gap:8px;min-width:0;padding:var(--cx-pad)}
${X} .wa-cx-tile__label{display:flex;align-items:flex-start;justify-content:space-between;gap:.75em;font-size:var(--cx-meta);
  line-height:1.4;color:var(--cx-ink2);overflow-wrap:break-word}
${X} .wa-cx-tile__label>span{min-width:0}
${X} .wa-cx-tile__ic{width:1.25em;height:1.25em}
${X} .wa-cx-tile__value{margin-top:4px;font-family:var(--wa-font-display);font-size:var(--cx-big);line-height:1.1;font-weight:600;
  letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--wa-ink);overflow-wrap:anywhere}
${X} .wa-cx-tile__note{color:var(--cx-ink2);font-size:var(--cx-meta);line-height:1.45;overflow-wrap:break-word}

/* Compare: a real table with no fills; stacked labelled rows in a narrow column or at large text. */
${X} .wa-cx-table{min-width:0;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain}
${X} .wa-cx-table table{border-collapse:collapse;width:100%}
${X} .wa-cx-table :is(th,td){padding:var(--cx-in) var(--cx-gap) var(--cx-in) 0;text-align:left;vertical-align:top;font-weight:400;
  border-bottom:var(--cx-hair) solid var(--cx-line);overflow-wrap:break-word}
${X} .wa-cx-table :is(th,td):last-child{padding-right:0}
${X} .wa-cx-table thead th{font-size:var(--cx-lead);font-weight:500;line-height:1.4;color:var(--wa-ink)}
${X} .wa-cx-table tbody th{font-weight:500}
${X} .wa-cx-stack{display:none;flex-direction:column}
${X} .wa-cx-stack__row{padding-block:var(--cx-in)}
${X} .wa-cx-stack__row:first-child{padding-top:0}
${X} .wa-cx-stack__row+.wa-cx-stack__row{border-top:var(--cx-hair) solid var(--cx-line)}
${X} .wa-cx-stack__title{font-size:var(--cx-lead);line-height:1.45;font-weight:600;margin-bottom:8px}
${X} .wa-cx-stack__cell{display:flex;flex-direction:column;padding-block:4px}
${X} .wa-cx-stack__cell dt{font-size:var(--cx-meta);line-height:1.45;color:var(--cx-ink2)}
${X} .wa-cx-stack__cell dd{overflow-wrap:break-word}
@container wa-cx (max-width:34em){
  ${X} .wa-cx-table{display:none}
  ${X} .wa-cx-stack{display:flex}
}
@container wa-cx (max-width:52em){
  ${X} .wa-cx-compare[data-wide] .wa-cx-table{display:none}
  ${X} .wa-cx-compare[data-wide] .wa-cx-stack{display:flex}
}

/* Callouts: a hairline card with its icon and title; a warning is warm amber, calm and unmistakable. */
${X} .wa-cx-callout{display:flex;flex-direction:column;gap:6px;padding:calc(var(--cx-pad) - 4px) var(--cx-pad)}
${X} .wa-cx-callout .wa-cx-head{margin-bottom:0;font-size:var(--cx-lead);line-height:1.45;font-family:var(--wa-font)}
${X} .wa-cx-callout .wa-cx-head__ic{width:1.2em;height:1.2em;margin-top:.1em}
${X} .wa-cx-callout__text{overflow-wrap:break-word}
${X} .wa-cx-callout[data-tone=warning]{background:var(--wa-warning-tint);border-color:color-mix(in srgb,var(--wa-warning) 32%,var(--wa-warning-tint))}
${X} .wa-cx-callout[data-tone=warning] .wa-cx-head__ic{color:var(--wa-warning)}
${X} .wa-cx-callout[data-tone=important] .wa-cx-head__ic{color:var(--wa-ink)}
${X} .wa-cx-callout[data-tone=key] .wa-cx-head__ic{color:var(--cx-accent)}

/* Definitions: the term, its meaning beside it when there is room. */
${X} .wa-cx-def{display:grid;grid-template-columns:minmax(0,1fr);gap:4px var(--cx-gap);padding-block:var(--cx-in)}
${X} .wa-cx-def+.wa-cx-def{border-top:var(--cx-hair) solid var(--cx-line)}
${X} .wa-cx-def:first-child{padding-top:0}
${X} .wa-cx-def__term{font-size:var(--cx-lead);line-height:1.45;font-weight:600;overflow-wrap:break-word}
${X} .wa-cx-def__meaning{color:var(--cx-ink2);overflow-wrap:break-word}
@container wa-cx (min-width:40em){
  ${X} .wa-cx-def{grid-template-columns:minmax(8em,14em) minmax(0,1fr)}
  ${X} .wa-cx-def__meaning{padding-top:calc((1.45 * var(--cx-lead) - var(--wa-lh-body) * 1em) / 2)}
}

/* A quote: the page's exact words, bigger, and who said them. */
${X} .wa-cx-quote{display:flex;flex-direction:column;gap:10px;padding-left:var(--cx-gap);border-left:3px solid var(--cx-line)}
${X} .wa-cx-quote__text{font-size:var(--cx-quote);line-height:1.5;font-weight:500;letter-spacing:-.005em;color:var(--wa-ink);
  overflow-wrap:break-word;text-wrap:pretty}
${X} .wa-cx-quote__who{color:var(--cx-ink2)}

/* Points: two columns of icon, title and a line of text, with no boxes (one column when narrow). */
${X} .wa-cx-pointgrid{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--cx-gap) calc(var(--cx-gap) * 1.6)}
@container wa-cx (min-width:36em){
  ${X} .wa-cx-pointgrid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
${X} .wa-cx-point{display:grid;grid-template-columns:minmax(0,1fr);column-gap:max(14px,.8em);min-width:0}
${X} .wa-cx-point[data-icon]{grid-template-columns:calc(var(--wa-f) * 1.3) minmax(0,1fr)}
${X} .wa-cx-point__ic{width:calc(var(--wa-f) * 1.3);height:calc(var(--wa-f) * 1.3);margin-top:calc((1.3 * var(--cx-title) - 1.3 * var(--wa-f)) / 2)}
${X} .wa-cx-point__body{grid-column:-2 / -1;min-width:0}
${X} .wa-cx-point__title{font-family:var(--wa-font-display);font-size:var(--cx-title);line-height:1.3;font-weight:600;
  letter-spacing:var(--wa-tr-title);color:var(--wa-ink);overflow-wrap:break-word}
${X} .wa-cx-point__text{margin-top:6px;color:var(--cx-ink2);overflow-wrap:break-word}

/* The group settles in once, top to bottom (nothing moves under reduced motion). */
@media (prefers-reduced-motion:no-preference){
  ${X}[data-settle]>.wa-cx-block{animation:wa-cx-in .3s cubic-bezier(.2,.8,.2,1) both;animation-delay:calc(var(--cx-i,0) * 40ms)}
}
@keyframes wa-cx-in{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
`;
