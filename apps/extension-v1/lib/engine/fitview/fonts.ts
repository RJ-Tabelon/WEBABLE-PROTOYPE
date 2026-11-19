import type { FitLayout } from '@webable/core';

/**
 * Fit view's faces (docs/12 §4.2). The default is the system UI face, the
 * one the reference stores use (SF Pro on Apple platforms, Segoe UI
 * Variable on Windows, Roboto on Android). Atkinson Hyperlegible Next stays
 * for a future legibility setting: it is registered from bytes the worker
 * passes (`new FontFace(name, bytes)`), so the extension needs no
 * web-accessible resources and the page cannot load or probe the file.
 * `@font-face` rules do not apply inside a shadow root, so both Atkinson
 * faces are added to the document's FontFaceSet under names no site uses.
 *
 * Until the bytes arrive, a metric-matched fallback keeps line breaks and
 * heights where Atkinson will put them (the same overrides as
 * packages/tokens/src/fonts.css).
 */

export const FONT_FAMILY = 'WebAble Fit Sans';
export const FALLBACK_FAMILY = 'WebAble Fit Fallback';

/**
 * x-height / em of Tune's reading stimulus, Noto Sans 400 (536/1000;
 * apps/web/components/tune/reading/geometry.ts). With `font-size-adjust` every
 * face in the stack draws its x-height where Noto Sans would at the same size,
 * so F means in Fit view what Tune measured, whichever face is drawn.
 */
export const X_HEIGHT_ADJUST = 0.536;

/** The system UI face for running text and controls. */
const SYSTEM_TEXT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
/** Headings: the display cuts first, then the same stack. */
const SYSTEM_DISPLAY = `"SF Pro Display", "Segoe UI Variable Display", ${SYSTEM_TEXT}`;

const atkinsonStack = (fallback: string): string =>
  `"${FONT_FAMILY}", "Atkinson Hyperlegible Next", "${FALLBACK_FAMILY}", ${fallback}`;

/** The face for running text and controls. */
export function fontStack(font: FitLayout['type']['font']): string {
  return font === 'system' ? SYSTEM_TEXT : atkinsonStack(SYSTEM_TEXT);
}

/** The face for the three heading tiers. */
export function displayStack(font: FitLayout['type']['font']): string {
  return font === 'system' ? SYSTEM_DISPLAY : atkinsonStack(SYSTEM_DISPLAY);
}

/** Decode the worker's base64 woff2 (runtime messages are JSON). */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

const unquote = (family: string): string =>
  family.replace(/^["']|["']$/g, '').trim();

function hasFace(doc: Document, family: string): FontFace | null {
  const set = doc.fonts as FontFaceSet | undefined;
  if (!set) return null;
  for (const face of set as unknown as Iterable<FontFace>) {
    if (unquote(face.family) === family && face.status !== 'error') return face;
  }
  return null;
}

/** Resolve after `ms` at most: a slow face must never hold the view back. */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    p,
    new Promise<null>((r) => setTimeout(() => r(null), ms)),
  ]);
}

export interface FontState {
  /** Atkinson is registered and loaded in this document. */
  atkinson: boolean;
}

/**
 * Register the fallback face (always) and Atkinson (when `b64` is given and
 * the document does not have it yet). Waits briefly for the faces to load, so
 * the first paint already uses them and the view does not shift; never throws.
 */
export async function registerFonts(
  doc: Document,
  b64: string | undefined,
  waitMs = 150,
): Promise<FontState> {
  const set = doc.fonts as FontFaceSet | undefined;
  if (!set || typeof FontFace !== 'function') return { atkinson: false };
  const pending: Array<Promise<unknown>> = [];
  try {
    if (!hasFace(doc, FALLBACK_FAMILY)) {
      // Regular and bold from their own local faces (never a synthetic
      // bold); the semibold the layout asks of Atkinson draws as regular.
      for (const [src, weight] of [
        [
          "local('Arial'), local('ArialMT'), local('Liberation Sans')",
          '100 649',
        ],
        [
          "local('Arial Bold'), local('Arial-BoldMT'), local('Liberation Sans Bold')",
          '650 900',
        ],
      ] as const) {
        const fallback = new FontFace(
          FALLBACK_FAMILY,
          src,
          // size-adjust is not in TypeScript's DOM lib yet; Chrome 92+ has it.
          {
            weight,
            sizeAdjust: '98.9%',
            ascentOverride: '99.5%',
            descentOverride: '32%',
            lineGapOverride: '0%',
          } as FontFaceDescriptors,
        );
        set.add(fallback);
        pending.push(fallback.load().catch(() => null));
      }
    }
  } catch {
    // A platform without descriptor overrides: the system stack follows.
  }
  let face = hasFace(doc, FONT_FAMILY);
  if (!face && b64) {
    try {
      face = new FontFace(FONT_FAMILY, base64ToBytes(b64), {
        weight: '200 800',
        style: 'normal',
        display: 'block',
      });
      set.add(face);
    } catch {
      face = null;
    }
  }
  if (face) pending.push(face.loaded.catch(() => null));
  await within(Promise.all(pending), waitMs);
  return { atkinson: face?.status === 'loaded' };
}
