import { tokenize } from '@webable/core/page/vocab';

import { isRenderedBox } from './visible';

/**
 * Privacy gates of the read (docs/10 §6, §8; review 2 #4):
 *  - a page with a rendered password, one-time-code or payment field is not
 *    read at all (readSkeleton resolves null), and neither is one showing a
 *    card-field iframe from a payment provider;
 *  - tokens typed into fields or present in the URL query are collected
 *    (LOCAL ONLY) so the wire conversion can strip them from every label,
 *    even when they are vocabulary words.
 * Field values are read only to build that strip list; they are never put
 * in a node.
 */

/** Password and one-time-code fields. */
export const PASSWORD_FIELD_SELECTOR = [
  'input[type="password" i]',
  '[autocomplete*="one-time-code" i]',
  '[autocomplete*="new-password" i]',
  '[autocomplete*="current-password" i]',
].join(',');

/** Card fields (autocomplete cc-*, and the usual card number and CVC names). */
export const PAYMENT_FIELD_SELECTOR = [
  '[autocomplete*="cc-" i]',
  'input[name*="cardnumber" i]',
  'input[name*="card_number" i]',
  'input[name*="card-number" i]',
  'input[name*="cvc" i]',
  'input[name*="cvv" i]',
  'input[id*="cardnumber" i]',
  'input[id*="card-number" i]',
].join(',');

export const SENSITIVE_FIELD_SELECTOR = `${PASSWORD_FIELD_SELECTOR},${PAYMENT_FIELD_SELECTOR}`;

/** Card-field iframes of payment providers (hosted fields), not their buttons. */
export const PAYMENT_FRAME_SELECTOR = [
  'iframe[name^="__privateStripeFrame"]',
  'iframe[src*="js.stripe.com/v3/elements-inner"]',
  'iframe[id^="braintree-hosted-field"]',
  'iframe[src*="braintreegateway.com"][src*="hosted-fields"]',
  'iframe[src*="securedFields"]',
  'iframe[src*="pci-connect.squareup.com"]',
  'iframe[name^="cko-frames"]',
  'iframe[src*="api.recurly.com/js/v1/field"]',
  'iframe[src*="paypal.com"][src*="card-fields"]',
  'iframe[title*="card number" i]',
  'iframe[title*="secure card" i]',
  'iframe[title*="credit card" i]',
].join(',');

const SENSITIVE_ANY = `${SENSITIVE_FIELD_SELECTOR},${PAYMENT_FRAME_SELECTOR}`;

/** Some element under `root` matching `selector` is rendered (hidden ones do not count). */
export function hasRendered(root: ParentNode, selector: string): boolean {
  let n = 0;
  for (const el of root.querySelectorAll(selector)) {
    if (++n > 200) return true;
    if (isRenderedBox(el)) return true;
  }
  return false;
}

/** A rendered password or payment field (or card-field frame) under `root`. */
export function hasSensitiveField(root: ParentNode): boolean {
  return hasRendered(root, SENSITIVE_ANY);
}

/** One element is a password, one-time-code or payment field (or card frame). */
export function isSensitiveField(el: Element): boolean {
  return el.matches(SENSITIVE_ANY) && isRenderedBox(el);
}

const TYPED_INPUT_SELECTOR =
  'input:not([type]), input[type="text" i], input[type="search" i], input[type="email" i], input[type="tel" i], input[type="url" i], input[type="number" i], textarea';
const EDITABLE_SELECTOR =
  '[contenteditable=""], [contenteditable="true" i], [contenteditable="plaintext-only" i]';

const MAX_TYPED = 300;

/** Lowercase tokens of `text`: the wire tokenizer's, plus whole letter runs (no camelCase split). */
export function typedTokensOf(text: string, into: Set<string>): void {
  if (!text) return;
  const s = text.length > 4096 ? text.slice(0, 4096) : text;
  for (const t of tokenize(s)) {
    if (into.size >= MAX_TYPED) return;
    into.add(t);
  }
  for (const t of s.toLowerCase().split(/[^a-z]+/)) {
    if (into.size >= MAX_TYPED) return;
    if (t.length >= 2 && t.length <= 20) into.add(t);
  }
}

/**
 * Query values of a URL, and what a hash carries after its route name
 * (Gmail keeps searches there: #search/<terms>, #label/<name>). A bare
 * fragment (#comments, #inbox) names a place, not something typed.
 */
export function urlTokens(url: string, into: Set<string>): void {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return;
  }
  for (const [, v] of u.searchParams) typedTokensOf(v, into);
  if (u.hash.length <= 1) return;
  let h = u.hash.slice(1);
  try {
    h = decodeURIComponent(h.replace(/\+/g, ' '));
  } catch {
    // keep the raw hash
  }
  const route = /^!?\/?[a-z][\w-]*\/(.*)$/i.exec(h);
  if (route) {
    typedTokensOf(route[1] ?? '', into);
    return;
  }
  if (h.includes('=')) {
    for (const [, v] of new URLSearchParams(h)) typedTokensOf(v, into);
    return;
  }
  if (/\s/.test(h)) typedTokensOf(h, into);
}

/**
 * Tokens typed into text fields and editors (in `roots`) or present in the
 * page URL's query and hash. LOCAL ONLY.
 */
export function typedTokens(
  roots: readonly ParentNode[],
  url: string,
): string[] {
  const out = new Set<string>();
  urlTokens(url, out);
  for (const root of roots) {
    for (const el of root.querySelectorAll(TYPED_INPUT_SELECTOR)) {
      const v = (el as HTMLInputElement | HTMLTextAreaElement).value;
      if (v) typedTokensOf(v, out);
      if (out.size >= MAX_TYPED) break;
    }
    const editors = [...root.querySelectorAll(EDITABLE_SELECTOR)];
    for (const ed of editors) {
      if (editors.some((o) => o !== ed && o.contains(ed))) continue;
      typedTokensOf((ed.textContent ?? '').slice(0, 2000), out);
      if (out.size >= MAX_TYPED) break;
    }
  }
  return [...out];
}
