// Owner: P (round 7). Layout around the purpose components (the components style themselves: ./components).
// Scoped under .wa-calm like calmCss; sized only from the fit's --wa-* tokens. Never use url().
const C = '.wa-calm';

export const purposeCss: string = `
${C} .wa-purpose{display:block}
${C} .wa-purpose__item{display:block}
${C} .wa-purpose__item+.wa-purpose__item{margin-top:var(--wa-band-gap)}
${C} .wa-purpose__orient{margin-bottom:var(--wa-card-gap)}
${C} .wa-purpose__orient>.wa-h-section{margin:0 0 var(--wa-gap-s)}
${C} .wa-purpose__action{margin-bottom:var(--wa-band-gap)}
${C} .wa-purpose__action:only-child{margin-bottom:0}
${C} .wa-purpose__links{display:flex;flex-wrap:wrap;align-items:center;gap:var(--wa-gap-s) var(--wa-gap);margin-top:var(--wa-gap-s)}
${C} .wa-purpose__links>*{margin:0}
${C} .wa-purpose__more{margin-top:var(--wa-gap-s)}
`;
