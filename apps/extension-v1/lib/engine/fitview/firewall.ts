import { FIREWALL_KEY, type FirewallTarget } from './types';

/**
 * Fit view's input firewall (docs/10 §4.5).
 *
 * Two halves, kept in one module so the event list and the marks agree:
 *
 *   installFirewall   engine.js, document_start, every page. Window-capture
 *                     listeners that run before any page listener. An event
 *                     whose target is the Fit view host (events from inside
 *                     the closed root are retargeted to it) is stopped with
 *                     stopImmediatePropagation and handed to the view. Never
 *                     preventDefault: typing, focus and scrolling still happen.
 *   createViewRouter  fitview.js. The view's dispatcher: finds the real
 *                     target inside the closed root (elementFromPoint for
 *                     pointers, activeElement for keys) and re-dispatches a
 *                     non-composed copy there, so the view's own listeners
 *                     work while the page sees nothing.
 *
 * Site shortcuts (Gmail e/#/j/k, YouTube / and k), wheel hijackers and
 * focus traps never see input meant for Fit view. Untrusted events are
 * ignored: a page cannot drive the view by dispatching to the host.
 */

/** Events the firewall stops at the host. All of them are composed. */
export const FIREWALL_EVENTS = [
  'pointerover',
  'pointerenter',
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'pointerout',
  'pointerleave',
  'gotpointercapture',
  'lostpointercapture',
  'mouseover',
  'mouseenter',
  'mousedown',
  'mousemove',
  'mouseup',
  'mouseout',
  'mouseleave',
  'click',
  'auxclick',
  'dblclick',
  'contextmenu',
  'wheel',
  'mousewheel',
  'touchstart',
  'touchmove',
  'touchend',
  'touchcancel',
  'keydown',
  'keypress',
  'keyup',
  'beforeinput',
  'input',
  'textInput',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'focus',
  'blur',
  'focusin',
  'focusout',
  'copy',
  'cut',
  'paste',
  'selectstart',
  'dragstart',
  'drag',
  'dragend',
  'dragenter',
  'dragover',
  'dragleave',
  'drop',
] as const;

/**
 * Scrolling and touch listeners on window are passive by default; an active
 * one would make every page's scrolling wait for the main thread. The
 * firewall never cancels, so passive costs nothing.
 */
const PASSIVE = new Set<string>([
  'wheel',
  'mousewheel',
  'touchstart',
  'touchmove',
]);

const INSTALLED = Symbol.for('webable.fitview.firewall.installed');

type Guarded = { [INSTALLED]?: () => void };

function firewallTarget(): FirewallTarget | undefined {
  return (globalThis as { [FIREWALL_KEY]?: FirewallTarget })[FIREWALL_KEY];
}

/**
 * Install the firewall on `win` (window capture). Idempotent per window: a
 * second injection reuses the running one. The listeners are inert until the
 * Fit view host registers globalThis[FIREWALL_KEY]. Returns an uninstall
 * (tests; the engine keeps it for the document's lifetime).
 */
export function installFirewall(win: Window): () => void {
  const guarded = win as Window & Guarded;
  const running = guarded[INSTALLED];
  if (running) return running;
  const onEvent = (e: Event): void => {
    if (!e.isTrusted) return;
    const fw = firewallTarget();
    if (!fw || e.target !== fw.host) return;
    e.stopImmediatePropagation();
    try {
      fw.dispatch(e);
    } catch {
      // The view's errors never surface on the page.
    }
  };
  for (const type of FIREWALL_EVENTS)
    win.addEventListener(type, onEvent, {
      capture: true,
      passive: PASSIVE.has(type),
    });
  const uninstall = (): void => {
    for (const type of FIREWALL_EVENTS)
      win.removeEventListener(type, onEvent, { capture: true });
    if (guarded[INSTALLED] === uninstall) delete guarded[INSTALLED];
  };
  guarded[INSTALLED] = uninstall;
  return uninstall;
}

// ---------------------------------------------------------------------------
// Proxy events: what Fit view dispatches to the page's originals
// ---------------------------------------------------------------------------

const PROXY_EVENTS = Symbol.for('webable.fitview.proxy-events');

/**
 * Every synthetic event Fit view dispatches to an original element, shared
 * through the isolated world's global so engine.js and fitview.js (separate
 * bundles) see one set. WebAble's own page listeners (steady_clicks, friction)
 * skip these.
 */
function proxyEvents(): WeakSet<Event> {
  const g = globalThis as { [PROXY_EVENTS]?: WeakSet<Event> };
  return (g[PROXY_EVENTS] ??= new WeakSet<Event>());
}

export function markProxyEvent<E extends Event>(e: E): E {
  proxyEvents().add(e);
  return e;
}

/** True for an event Fit view dispatched to a page element. */
export function isProxyEvent(e: Event): boolean {
  return proxyEvents().has(e);
}

// ---------------------------------------------------------------------------
// The view's router (fitview.js)
// ---------------------------------------------------------------------------

/** Copies the router delivered inside the view (accepted by view listeners). */
const viewEvents = new WeakSet<Event>();

/** True for a copy of a person's event, delivered inside the view by the router. */
export function isViewEvent(e: Event): boolean {
  return viewEvents.has(e);
}

/** A person's real event, or the router's copy of one. */
export function isPersonEvent(e: Event): boolean {
  return e.isTrusted || viewEvents.has(e);
}

/**
 * Re-dispatched inside the view. Everything else is only stopped: hover
 * transitions (CSS covers them), touch (pointer events and click follow),
 * auxclick and contextmenu (their defaults act natively: a middle click opens
 * a view link's own href in a new tab), drag, and wheel (it scrolls natively).
 */
const ROUTED = new Set<string>([
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'mousedown',
  'mousemove',
  'mouseup',
  'click',
  'dblclick',
  'keydown',
  'keypress',
  'keyup',
  'beforeinput',
  'input',
  'compositionstart',
  'compositionupdate',
  'compositionend',
  'focus',
  'blur',
  'focusin',
  'focusout',
  'copy',
  'cut',
  'paste',
]);

const POINTER_ROUTED = new Set<string>([
  'pointerdown',
  'pointermove',
  'pointerup',
  'pointercancel',
  'mousedown',
  'mousemove',
  'mouseup',
  'click',
  'dblclick',
]);

/** Elements whose click has an activation behaviour (HTML §activation). */
const ACTIVATION_SELECTOR = 'a[href],area[href],button,input,label,summary';
const ACTIVATING_INPUT_TYPES = new Set([
  'checkbox',
  'radio',
  'submit',
  'image',
  'reset',
  'button',
  'file',
  'color',
]);

/** The focused element inside `root`, through nested open roots. */
export function deepActive(root: ShadowRoot): Element | null {
  let a: Element | null = root.activeElement;
  while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
  return a;
}

/** Nearest element (inside the view) whose click would activate something. */
function activationTarget(
  el: Element | null,
  root: ShadowRoot,
): Element | null {
  for (let n: Element | null = el; n; n = n.parentElement) {
    if (n.matches(ACTIVATION_SELECTOR)) {
      if (n instanceof HTMLInputElement)
        return ACTIVATING_INPUT_TYPES.has(n.type) ? n : null;
      return n;
    }
    if (n.parentNode === root) break;
  }
  return null;
}

/**
 * A pointer event's real target inside the view. Keyboard-generated clicks
 * (Enter or Space on a focused control) carry pointerType '' and no
 * coordinates; they belong to the focused element.
 */
function pointerTarget(e: MouseEvent, root: ShadowRoot): Element | null {
  const pt = (e as PointerEvent).pointerType;
  const keyboard =
    e.type === 'click' &&
    (pt === '' || (e.detail === 0 && e.clientX === 0 && e.clientY === 0));
  if (keyboard) return deepActive(root);
  return root.elementFromPoint(e.clientX, e.clientY);
}

function copyMouse(e: MouseEvent, related: EventTarget | null): MouseEventInit {
  return {
    bubbles: e.bubbles,
    cancelable: e.cancelable,
    composed: false,
    view: e.view,
    detail: e.detail,
    screenX: e.screenX,
    screenY: e.screenY,
    clientX: e.clientX,
    clientY: e.clientY,
    ctrlKey: e.ctrlKey,
    shiftKey: e.shiftKey,
    altKey: e.altKey,
    metaKey: e.metaKey,
    button: e.button,
    buttons: e.buttons,
    movementX: e.movementX,
    movementY: e.movementY,
    relatedTarget: related,
  };
}

/** A non-composed copy of `e`, same constructor and fields, for `target`. */
export function copyEvent(e: Event, related: EventTarget | null = null): Event {
  const base = {
    bubbles: e.bubbles,
    cancelable: e.cancelable,
    composed: false,
  };
  if (typeof PointerEvent === 'function' && e instanceof PointerEvent)
    return new PointerEvent(e.type, {
      ...copyMouse(e, related),
      pointerId: e.pointerId,
      width: e.width,
      height: e.height,
      pressure: e.pressure,
      tangentialPressure: e.tangentialPressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      twist: e.twist,
      pointerType: e.pointerType,
      isPrimary: e.isPrimary,
    });
  if (e instanceof MouseEvent)
    return new MouseEvent(e.type, copyMouse(e, related));
  if (e instanceof KeyboardEvent)
    return new KeyboardEvent(e.type, {
      ...base,
      view: e.view,
      key: e.key,
      code: e.code,
      location: e.location,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
      repeat: e.repeat,
      isComposing: e.isComposing,
      charCode: e.charCode,
      keyCode: e.keyCode,
    } as KeyboardEventInit);
  if (typeof InputEvent === 'function' && e instanceof InputEvent)
    return new InputEvent(e.type, {
      ...base,
      view: e.view,
      data: e.data,
      inputType: e.inputType,
      isComposing: e.isComposing,
      dataTransfer: e.dataTransfer,
    });
  if (typeof CompositionEvent === 'function' && e instanceof CompositionEvent)
    return new CompositionEvent(e.type, {
      ...base,
      view: e.view,
      data: e.data,
    });
  if (e instanceof FocusEvent)
    return new FocusEvent(e.type, {
      ...base,
      view: e.view,
      relatedTarget: related,
    });
  if (typeof ClipboardEvent === 'function' && e instanceof ClipboardEvent)
    return new ClipboardEvent(e.type, {
      ...base,
      clipboardData: e.clipboardData,
    });
  return new Event(e.type, base);
}

export interface ViewRouter {
  /** FirewallTarget.dispatch: route one stopped event into the view. */
  dispatch(e: Event): void;
  dispose(): void;
}

/**
 * The view's dispatcher. For each stopped event it finds the real target in
 * the closed root and delivers a non-composed copy there (it never leaves
 * the shadow root), so the view's ordinary listeners run. A listener that
 * cancels the copy cancels the person's event.
 *
 * Clicks: the copy carries the activation (a view link navigates, a summary
 * toggles) and the original click is cancelled so nothing activates twice.
 * Checkboxes, radios and labels keep their native activation instead (the
 * view reads their `change`, which never leaves the root). Clicks with a
 * modifier or a non-primary button are left to the browser: a view link's own
 * href opens in a new tab.
 */
export function createViewRouter(root: ShadowRoot): ViewRouter {
  // Focus moves inside the root never reach window (related targets retarget
  // to the host), so the last focused element is tracked from inside.
  let lastActive: Element | null = deepActive(root);
  const track = (e: Event): void => {
    const t = e.target;
    if (t instanceof Element) lastActive = t;
  };
  root.addEventListener('focusin', track, true);

  const targetFor = (e: Event): Element | null => {
    if (POINTER_ROUTED.has(e.type) && e instanceof MouseEvent)
      return pointerTarget(e, root);
    if (e.type === 'blur' || e.type === 'focusout')
      return lastActive?.isConnected ? lastActive : null;
    return deepActive(root);
  };

  const dispatch = (e: Event): void => {
    if (!ROUTED.has(e.type)) return;
    const inner = targetFor(e);
    if (!inner || !root.contains(inner)) return;
    let activation: Element | null = null;
    if (e.type === 'click' && e instanceof MouseEvent) {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey)
        return;
      activation = activationTarget(inner, root);
      if (
        activation instanceof HTMLLabelElement ||
        (activation instanceof HTMLInputElement &&
          (activation.type === 'checkbox' || activation.type === 'radio'))
      )
        return;
    }
    const related = e instanceof FocusEvent ? e.relatedTarget : null;
    const copy = copyEvent(e, related);
    viewEvents.add(copy);
    const delivered = inner.dispatchEvent(copy);
    if (e.type === 'focus') lastActive = inner;
    if (!e.cancelable || PASSIVE.has(e.type)) return;
    // The copy activated (or a listener cancelled it): the original must not.
    if (!delivered || activation) e.preventDefault();
  };

  return {
    dispatch,
    dispose() {
      root.removeEventListener('focusin', track, true);
      lastActive = null;
    },
  };
}
