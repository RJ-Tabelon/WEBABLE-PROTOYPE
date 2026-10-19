import { chevron, h, type RenderCtx } from './components';

/**
 * The card toggle of a "More on this page" drawer (docs/12 §5 Drawers): the
 * title at title size, the count in a tonal chip and a chevron in a tonal
 * circle that turns when open; the content renders when first opened. The
 * DOM and the name stay WebAble's disclosure (`.fv-disclosure`, a fern
 * `.fv-wa` toggle with aria-expanded, "Site links (12)"), so everything
 * that finds drawers and their counts still does.
 */
export function cardDisclosure(
  ctx: RenderCtx,
  o: {
    title: string;
    count: number;
    render: () => Node;
    /** Ids reachable behind it (conservation), counted while closed. */
    reach?: string[];
  },
): HTMLElement {
  const doc = ctx.doc;
  const wrap = h(doc, 'div', 'fv-disclosure');
  const bar = h(doc, 'div', 'fv-disclosure__bar');
  const body = h(doc, 'div', 'fv-collapsed');
  body.id = ctx.uid('d');
  body.hidden = true;
  const toggle = h(doc, 'button', 'fv-wa fv-drawer__toggle');
  toggle.type = 'button';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', body.id);
  // The parentheses are read, not drawn: the chip shows the count.
  const count = h(doc, 'span', 'fv-drawer__count');
  count.append(
    h(doc, 'span', 'fv-sr', '('),
    doc.createTextNode(String(o.count)),
    h(doc, 'span', 'fv-sr', ')'),
  );
  const turn = h(doc, 'span', 'fv-drawer__chev');
  turn.append(chevron(doc, 'down'));
  toggle.append(
    h(doc, 'span', 'fv-drawer__title t-title', o.title),
    doc.createTextNode(' '),
    count,
    turn,
  );
  let built = false;
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true';
    if (open && !built) {
      built = true;
      body.append(o.render());
    }
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });
  for (const id of o.reach ?? []) ctx.reach(id);
  bar.append(toggle);
  wrap.append(bar, body);
  return wrap;
}
