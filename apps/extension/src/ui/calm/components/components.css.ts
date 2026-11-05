// Owner: Alfred (round 7). Styles for the meaning-first Calm components.
// One family, weights 400 / 500 / 600, hairline dividers, no cards. Lengths come from Calm's --wa-* tokens.
// A constructed stylesheet cannot use a CSS url function: some pages' security rules block it.

export const componentsCss = `
.wa-mc,.wa-mc *,.wa-mc *::before,.wa-mc *::after{box-sizing:border-box}
.wa-mc{font-family:var(--wa-font);font-size:var(--wa-f);font-weight:400;line-height:var(--wa-lh-body);color:var(--wa-ink);
  width:100%;max-width:100%;min-width:0}
.wa-mc :is(h2,h3,p,figure,figcaption){margin:0}
.wa-mc ul{list-style:none;margin:0;padding:0}
.wa-mc ol{margin:0}
.wa-mc h2,.wa-mc h3{font-family:inherit;font-weight:600;line-height:var(--wa-lh-section)}
.wa-mc h2{font-size:var(--wa-f-section)}
.wa-mc h3{font-size:var(--wa-f-section)}
.wa-mc button{font:inherit;color:inherit;letter-spacing:inherit}
.wa-mc :focus-visible{outline:var(--wa-ring) solid var(--wa-focus);outline-offset:2px}

.wa-picbox{display:block;flex:none;overflow:hidden;border:0;border-radius:var(--wa-r-media);background:transparent;
  height:2.5em;width:auto;max-width:100%;aspect-ratio:var(--wa-mc-ratio,1)}
.wa-picbox img{display:block;width:100%;height:100%;object-fit:contain;border:0;background:transparent}
.wa-picbox--small{height:calc(var(--wa-f) * 2)}
.wa-picbox--score{height:calc(var(--wa-f) * 3.25)}
.wa-picbox--wide{width:100%;height:auto;max-width:var(--wa-wide-col);aspect-ratio:var(--wa-mc-ratio,3/2)}

.wa-statgrid{container-type:inline-size;container-name:wa-statgrid}
.wa-statgrid__title{margin-bottom:var(--wa-gap)}
.wa-statgrid__items{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--wa-gap) var(--wa-row-pad)}
@container wa-statgrid (min-width:32rem){
  .wa-statgrid__items{grid-template-columns:repeat(3,minmax(0,1fr))}
}
@container wa-statgrid (min-width:46rem){
  .wa-statgrid__items{grid-template-columns:repeat(4,minmax(0,1fr))}
}
.wa-statgrid__item{display:flex;flex-direction:column;align-items:flex-start;gap:var(--wa-gap-s);min-width:0;
  padding-bottom:var(--wa-gap);border-bottom:var(--wa-hair) solid var(--wa-line)}
.wa-statgrid__value{font-size:var(--wa-f-section);font-weight:600;line-height:var(--wa-lh-section);font-variant-numeric:tabular-nums}
.wa-statgrid__item[data-emphasis=lead] .wa-statgrid__value{font-size:var(--wa-f-page);line-height:var(--wa-lh-page)}
.wa-statgrid__label{color:var(--wa-ink-2);font-weight:500}
.wa-statgrid__sub{color:var(--wa-ink-2);font-weight:400}

.wa-scoreboard{display:grid;grid-template-columns:minmax(0,1fr);container-type:inline-size;container-name:wa-scoreboard}
.wa-scoreboard__head{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:var(--wa-gap-s) var(--wa-gap);
  margin-bottom:var(--wa-gap);padding-bottom:var(--wa-gap);border-bottom:var(--wa-hair) solid var(--wa-line)}
.wa-scoreboard__date{color:var(--wa-ink-2);font-variant-numeric:tabular-nums}
.wa-scoreboard__sides{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:var(--wa-gap)}
.wa-scoreboard__sides--pair{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);justify-items:center;align-items:center}
.wa-scoreboard__sides--plain{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
.wa-scoreboard__side{display:flex;flex-direction:column;align-items:center;text-align:center;gap:var(--wa-gap-s);min-width:0;max-width:100%}
.wa-scoreboard__sides:not(.wa-scoreboard__sides--pair) .wa-scoreboard__side{flex:1 1 8em}
.wa-scoreboard__name{font-weight:500;overflow-wrap:anywhere}
.wa-scoreboard__place{color:var(--wa-ink-2)}
.wa-scoreboard__score{font-size:var(--wa-f-page);font-weight:400;line-height:var(--wa-lh-page);font-variant-numeric:tabular-nums}
.wa-scoreboard__side[data-winner] .wa-scoreboard__name,
.wa-scoreboard__side[data-winner] .wa-scoreboard__score{font-weight:600}
.wa-scoreboard__won{font-weight:600}
.wa-scoreboard__joiner{color:var(--wa-ink-2);font-weight:500}
@container wa-scoreboard (max-width:28rem){
  .wa-scoreboard__sides--pair,.wa-scoreboard__sides--plain{grid-template-columns:minmax(0,1fr)}
}
.wa-scoreboard__linescroll{min-width:0;max-width:100%;margin-top:var(--wa-gap);overflow-x:auto;overscroll-behavior-x:contain}
.wa-scoreboard__lines{border-collapse:collapse;width:max-content;min-width:100%}
.wa-scoreboard__lines caption{caption-side:top;text-align:left;color:var(--wa-ink-2);font-weight:500;padding:var(--wa-gap) 0 var(--wa-gap-s)}
.wa-scoreboard__lines :is(th,td){padding:var(--wa-gap-s) var(--wa-gap);text-align:left;vertical-align:middle;white-space:nowrap;
  border-bottom:var(--wa-hair) solid var(--wa-line);font-weight:400}
.wa-scoreboard__lines [data-num]{text-align:right;font-variant-numeric:tabular-nums;font-weight:500}
.wa-scoreboard__lines th[scope=row]{font-weight:600}

.wa-datatable{display:grid;grid-template-columns:minmax(0,1fr)}
.wa-datatable__scroll{min-width:0;max-width:100%;overflow-x:auto;overscroll-behavior-x:contain}
.wa-datatable table{border-collapse:collapse;width:max-content;min-width:100%}
.wa-datatable caption{caption-side:top;text-align:left;font-family:inherit;font-size:var(--wa-f-section);font-weight:600;
  line-height:var(--wa-lh-section);padding-bottom:var(--wa-gap);white-space:normal}
.wa-datatable :is(th,td){padding:var(--wa-row-pad) var(--wa-gap);text-align:left;vertical-align:middle;white-space:nowrap;
  border-bottom:var(--wa-hair) solid var(--wa-line);font-weight:400}
.wa-datatable thead th{font-weight:600}
.wa-datatable [data-num]{text-align:right;font-variant-numeric:tabular-nums}
.wa-datatable tbody tr:nth-child(even){background:var(--wa-tonal)}
.wa-datatable__more{appearance:none;justify-self:start;background:transparent;border:0;margin-top:var(--wa-gap-s);
  padding:var(--wa-gap-s) 0;min-height:var(--wa-t);font-weight:500;color:var(--wa-ink);text-align:left;cursor:pointer;
  text-decoration:underline;text-decoration-thickness:max(1px,.06em);text-underline-offset:.2em}

.wa-schedule__heading{margin-bottom:var(--wa-gap)}
.wa-schedule__list{border-top:var(--wa-hair) solid var(--wa-line)}
.wa-schedule__row{display:grid;grid-template-columns:auto auto minmax(0,1fr) auto;align-items:center;column-gap:var(--wa-gap);
  row-gap:var(--wa-gap-s);width:100%;min-height:var(--wa-t);padding:var(--wa-row-pad) 0 var(--wa-row-pad) var(--wa-gap);
  background:transparent;border:0;border-bottom:var(--wa-hair) solid var(--wa-line);text-align:left;cursor:default}
button.wa-schedule__row{cursor:pointer}
button.wa-schedule__row:hover{background:var(--wa-hover)}
button.wa-schedule__row:active{background:var(--wa-press)}
.wa-schedule__item[data-current] .wa-schedule__row{box-shadow:inset var(--wa-ring) 0 0 var(--wa-ink)}
.wa-schedule__date{font-variant-numeric:tabular-nums;font-weight:500}
.wa-schedule__logo-spacer{width:calc(var(--wa-f) * 2);height:calc(var(--wa-f) * 2);flex:none}
.wa-schedule__main{display:flex;flex-direction:column;gap:0;min-width:0}
.wa-schedule__titleline{display:flex;flex-wrap:wrap;align-items:baseline;gap:var(--wa-gap-s)}
.wa-schedule__name{font-weight:500;overflow-wrap:anywhere}
.wa-schedule__item[data-current] .wa-schedule__name{font-weight:600}
.wa-schedule__current{font-weight:600}
.wa-schedule__detail{color:var(--wa-ink-2);font-weight:400;overflow-wrap:anywhere}
.wa-schedule__href{display:block;min-width:0;color:var(--wa-ink-2);font-weight:400;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wa-schedule__result{font-variant-numeric:tabular-nums;font-weight:500;white-space:nowrap;text-align:right}

.wa-recipe{display:flex;flex-direction:column;gap:var(--wa-gap)}
.wa-recipe>*{min-width:0}
.wa-recipe>h2{font-size:var(--wa-f-page);line-height:var(--wa-lh-page)}
.wa-recipe__figure{max-width:var(--wa-wide-col)}
.wa-recipe__meta{display:flex;flex-wrap:wrap;gap:var(--wa-gap) var(--wa-row-pad)}
.wa-recipe__meta li{display:flex;flex-direction:column;align-items:flex-start;gap:var(--wa-gap-s);min-width:5em}
.wa-recipe__metavalue{font-weight:600;font-variant-numeric:tabular-nums}
.wa-recipe__metalabel,.wa-recipe__metasub{color:var(--wa-ink-2);font-weight:500}
.wa-recipe__metasub{font-weight:400}
.wa-recipe__block{display:flex;flex-direction:column;gap:var(--wa-gap-s)}
.wa-recipe__ing{display:flex;align-items:center;gap:var(--wa-gap);min-height:var(--wa-t);padding:var(--wa-gap-s) 0;
  border-bottom:var(--wa-hair) solid var(--wa-line);cursor:pointer}
.wa-recipe__ing input{width:var(--wa-check);height:var(--wa-check);margin:0;flex:none;accent-color:var(--wa-ink)}
.wa-recipe__ingtext{overflow-wrap:anywhere}
.wa-recipe__ing[data-done] .wa-recipe__ingtext{text-decoration:line-through;color:var(--wa-ink-2)}
.wa-mc .wa-recipe__steps{list-style:decimal;padding-left:1.5em}
.wa-recipe__steps li{font-size:var(--wa-f-big);line-height:var(--wa-lh-body);padding:var(--wa-row-pad) 0;
  border-bottom:var(--wa-hair) solid var(--wa-line);overflow-wrap:anywhere}
.wa-recipe__steps li::marker{font-weight:600}
.wa-recipe__notes li{padding:var(--wa-gap) 0;border-bottom:var(--wa-hair) solid var(--wa-line);overflow-wrap:anywhere}

.wa-logomark{display:inline-flex;align-items:center;gap:var(--wa-gap-s);min-height:var(--wa-t);max-width:100%;font-weight:500}
.wa-logomark[data-size=small] .wa-picbox{height:calc(var(--wa-f) * 1.5)}
.wa-logomark[data-size=medium] .wa-picbox{height:calc(var(--wa-f) * 2.5)}
.wa-logomark[data-size=large]{font-size:var(--wa-f-big);font-weight:600}
.wa-logomark[data-size=large] .wa-picbox{height:calc(var(--wa-f) * 4)}
.wa-logomark__name{min-width:0;overflow-wrap:anywhere}
`;
