// Owner: U. Where the corner dock and the docked cookie bar go. Pure, so it can be tested.
//
// Everything here is in design pixels: the chrome layer is CSS-zoomed by (UI scale ÷ page zoom), so one CSS px inside
// it is one design pixel and the viewport measures the same as at 100% zoom. The dock is one column, bottom to top:
// pill, overlay chips, the offer, toasts; with the panel open, the panel takes the column above the pill and the rest
// moves beside it when there is room. The cookie bar sits at the bottom centre; the dock stays above it only when the
// two would otherwise share space.

export interface DockInput {
  /** Viewport, design px. */
  vw: number;
  vh: number;
  /** Space kept to the screen edges. */
  margin: number;
  /** Gap between the dock's parts. */
  gap: number;
  /** The pill's size. */
  pillW: number;
  pillH: number;
  /** Offers, toasts or chips to show. */
  hasItems: boolean;
  itemsW: number;
  panelOpen: boolean;
  panelW: number;
  /** The docked cookie bar's height, or null when there is none. */
  barH: number | null;
  barMaxW: number;
}

export interface DockPlan {
  /** The cookie bar's width (centred). */
  barW: number;
  /** The dock's lowest bottom edge: above the bar when they would overlap, else the margin. */
  minBottom: number;
  /** With the panel open: show the other items beside it (true) or hold them until it closes (false). */
  itemsBeside: boolean;
  /** Width the dock takes from its edge. */
  dockW: number;
}

const finite = (v: number, d: number): number => (Number.isFinite(v) ? v : d);

export function planDock(i: DockInput): DockPlan {
  const vw = Math.max(0, finite(i.vw, 0));
  const margin = finite(i.margin, 16);
  const besideGap = 12;
  const itemsBeside = i.panelOpen && i.hasItems && vw >= margin * 2 + i.panelW + besideGap + i.itemsW;
  const mainW = Math.max(i.pillW, i.panelOpen ? i.panelW : 0, !i.panelOpen && i.hasItems ? i.itemsW : 0);
  const dockW = Math.min(vw - margin * 2, mainW + (itemsBeside ? besideGap + i.itemsW : 0));
  const barW = Math.max(0, Math.min(i.barMaxW, vw - margin * 2));
  let minBottom = margin;
  if (i.barH !== null && i.barH > 0) {
    // The bar's edge and the dock's inner edge, measured from the dock's side of the screen.
    const barEdge = (vw - barW) / 2;
    const dockEdge = margin + dockW;
    if (dockEdge + i.gap > barEdge) minBottom = margin + i.barH + i.gap;
  }
  return { barW, minBottom, itemsBeside, dockW };
}

export interface DockHeights {
  /** Max height of the column above the pill (items or panel). */
  aboveMax: number;
  /** The launcher remains visible, including under an open panel on short screens. */
  pillWithPanel: boolean;
}

/** How tall the parts above the pill may grow, given where the dock's bottom is. */
export function dockHeights(vh: number, bottom: number, margin: number, pillH: number, gap: number, _panelOpen: boolean): DockHeights {
  const room = vh - bottom - margin;
  const withPill = room - pillH - gap;
  return { aboveMax: Math.max(0, withPill), pillWithPanel: true };
}

/**
 * The dock's bottom edge, kept low enough that the button stays fully on screen however short the window (a site
 * control in the corner, or the simplified page's action bar, may push the dock up).
 */
export function clampBottom(vh: number, bottom: number, margin: number, buttonH: number): number {
  const v = Number.isFinite(vh) ? vh : 0;
  const b = Number.isFinite(bottom) ? bottom : margin;
  const highest = Math.max(0, v - buttonH - Math.min(margin, 8));
  return Math.max(0, Math.min(b, highest));
}
