// Owner: P, U. The corner dock, WebAble's short note, the one pop-up card and the docked cookie-notice bar.
// Everything here sits in the zoomed chrome layer: lengths are design pixels and --wa-vw / --wa-vh are the viewport
// in design pixels. Colours are the sheet's --k-* tokens (panel.css.ts).
import { u } from '../panel/css-util';

export const offersCss = /* css */ `
/* ---------- the corner dock: the button, and above it the sheet or one small card ---------- */
.wa-dock {
  position: fixed; z-index: 41;
  display: flex; flex-direction: row-reverse; align-items: flex-end; gap: ${u(12)};
  pointer-events: none;
}
.wa-dock[data-side="left"] { flex-direction: row; }
.wa-dock-col {
  display: flex; flex-direction: column; align-items: flex-end; justify-content: flex-end; gap: ${u(12)};
  min-height: 0; pointer-events: none;
}
.wa-dock[data-side="left"] .wa-dock-col { align-items: flex-start; }
.wa-dock-content { display: flex; flex-direction: column; min-height: 0; flex: 0 1 auto; }
.wa-dock-content > .wa-sheet { pointer-events: auto; }
.wa-dock-items {
  display: flex; flex-direction: column; align-items: flex-end; gap: ${u(12)};
  width: min(${u(360)}, calc(var(--wa-vw, 100vw) - ${u(40)}));
  flex: 0 1 auto; min-height: 0; pointer-events: none;
}
.wa-dock[data-side="left"] .wa-dock-items { align-items: flex-start; }
.wa-dock-items > * { pointer-events: auto; flex: none; }
.wa-dock-items[data-scroll="true"] { overflow-y: auto; overscroll-behavior: contain; scrollbar-width: thin; }
.wa-dock-col > .wa-fab, .wa-dock-col > .wa-sheet { pointer-events: auto; }

/* ---------- WebAble's short note ---------- */
.wa-note {
  display: flex; align-items: center; gap: ${u(12)};
  max-width: min(${u(340)}, calc(var(--wa-vw, 100vw) - ${u(40)}));
  padding: ${u(14)} ${u(18)}; border-radius: ${u(18)};
  background: var(--k-card); color: var(--k-ink); border: ${u(1)} solid var(--k-edge);
  box-shadow: var(--k-shadow-btn);
  font-size: ${u(16)}; line-height: ${u(22)}; font-weight: 500;
  animation: wa-k-in 200ms var(--k-ease) both;
}
.wa-note i { flex: none; width: ${u(8)}; height: ${u(8)}; border-radius: 50%; background: var(--k-accent); }

/* ---------- shared pill buttons in the --k language ---------- */
.wa-kbtn {
  appearance: none; -webkit-appearance: none; margin: 0;
  display: inline-flex; align-items: center; justify-content: center; gap: ${u(8)};
  min-height: max(${u(48)}, var(--wa-target, 44px)); min-width: max(${u(48)}, var(--wa-target, 44px));
  padding: 0 ${u(20)}; border-radius: 999px;
  border: ${u(1)} solid var(--k-line-strong); background: var(--k-card); color: var(--k-ink);
  font: inherit; font-size: ${u(16)}; font-weight: 600; line-height: 1.2; white-space: nowrap;
  cursor: pointer; pointer-events: auto;
  transition: background-color 200ms var(--k-ease), transform 200ms var(--k-ease);
}
.wa-kbtn:hover { background: var(--k-canvas); }
.wa-kbtn:active { transform: scale(.98); }
.wa-kbtn-primary { background: var(--k-ink); color: var(--k-on-ink); border-color: transparent; }
.wa-kbtn-primary:hover { background: var(--k-ink); opacity: .9; }

/* ---------- one pop-up card ("A pop-up is covering this page.") ---------- */
.wa-offer {
  display: grid; gap: ${u(6)}; width: 100%;
  padding: ${u(20)}; border-radius: ${u(24)};
  background: var(--k-card); color: var(--k-ink); border: ${u(1)} solid var(--k-edge);
  box-shadow: var(--k-shadow);
  animation: wa-k-in 200ms var(--k-ease) both;
}
.wa-offer-q { margin: 0; font-size: ${u(17)}; line-height: ${u(24)}; font-weight: 600; letter-spacing: -0.01em; }
.wa-offer-fact { margin: 0; font-size: ${u(15)}; line-height: ${u(22)}; color: var(--k-ink2); }
.wa-offer-btns { display: grid; grid-template-columns: 1fr 1fr; gap: ${u(12)}; margin-top: ${u(14)}; }
.wa-offer-btns .wa-kbtn { width: 100%; }

/* ---------- the docked cookie-notice bar ---------- */
.wa-cbar {
  position: fixed; z-index: 37; margin: 0 auto; max-width: ${u(1080)};
  min-height: max(${u(76)}, calc(var(--wa-target, 44px) + ${u(24)}));
  display: flex; align-items: center; padding: ${u(12)} ${u(14)} ${u(12)} ${u(20)};
  border-radius: ${u(24)}; border: ${u(1)} solid var(--k-edge);
  background: var(--k-card); color: var(--k-ink); box-shadow: var(--k-shadow);
  pointer-events: auto; animation: wa-k-in 200ms var(--k-ease) both;
}
.wa-cbar-row { display: flex; align-items: center; gap: ${u(12)}; width: 100%; min-width: 0; overflow: hidden; }
.wa-cbar-icon {
  flex: none; width: ${u(36)}; height: ${u(36)}; border-radius: 50%; display: grid; place-items: center;
  background: var(--k-canvas); color: var(--k-ink2);
}
.wa-cbar-text { margin: 0; flex: 0 0 auto; min-width: 0; font-size: ${u(17)}; font-weight: 600; letter-spacing: -0.01em; white-space: nowrap; }
.wa-cbar[data-compact] .wa-cbar-text { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; }
.wa-cbar-gap { flex: 1 1 0; min-width: 0; }
.wa-cbar-choices { display: flex; align-items: center; gap: ${u(8)}; flex: none; }
.wa-cbar-btn { flex: none; font-weight: 500; }
.wa-cbar-read {
  appearance: none; border: 0; background: none; margin: 0; flex: none;
  display: inline-flex; align-items: center; gap: ${u(4)}; white-space: nowrap;
  min-height: max(${u(44)}, var(--wa-target, 44px)); padding: 0 ${u(8)};
  font: inherit; font-size: ${u(15)}; font-weight: 600; color: var(--k-ink2); cursor: pointer; pointer-events: auto; border-radius: ${u(10)};
}
.wa-cbar-read:hover { color: var(--k-ink); text-decoration: underline; text-underline-offset: ${u(3)}; }
.wa-root[data-mode="max"] .wa-cbar-btn { border-width: ${u(2)}; }
`;
