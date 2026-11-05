// Small text and image helpers for the routes.

const ABBREVIATIONS = /\b(?:e\.g|i\.e|etc|vs|approx|incl|no|nos|dept|est|min|max|mr|mrs|ms|dr|prof|st|ave|inc|ltd|co|corp|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec|u\.s|a\.m|p\.m)\.$/i;

/**
 * Split a passage into sentences for the coverage check: on . ! ? followed by space and an upper-case letter,
 * digit, quote or bracket, and on line breaks. Very short fragments join the sentence before them.
 */
export function splitSentences(passage: string, max = 24): string[] {
  const out: string[] = [];
  for (const block of passage.split(/\n+/)) {
    const b = block.replace(/\s+/g, ' ').trim();
    if (!b) continue;
    let start = 0;
    const re = /[.!?]["')\]]?\s+(?=["'(\[]?[A-Z0-9])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(b)) !== null) {
      const end = m.index + m[0].trimEnd().length;
      const candidate = b.slice(start, end).trim();
      if (ABBREVIATIONS.test(candidate)) continue;
      push(out, candidate);
      start = m.index + m[0].length;
    }
    push(out, b.slice(start).trim());
  }
  if (out.length <= max) return out;
  // Merge the tail so the check never exceeds `max` questions per kind.
  const head = out.slice(0, max - 1);
  head.push(out.slice(max - 1).join(' '));
  return head;
}

function push(out: string[], s: string): void {
  if (!s) return;
  const words = s.split(/\s+/).length;
  if (words < 3 && out.length > 0) out[out.length - 1] = `${out[out.length - 1]} ${s}`;
  else out.push(s);
}

export type ImageFormat = 'png' | 'jpg';

/** The image format from the first bytes of a base64 string. */
export function imageFormatOf(b64: string): ImageFormat | null {
  if (b64.startsWith('iVBORw0KGgo')) return 'png';
  if (b64.startsWith('/9j/')) return 'jpg';
  return null;
}

/** Width and height from a PNG's IHDR chunk, or null if the data is not a PNG. */
export function pngSize(b64: string): { width: number; height: number } | null {
  if (imageFormatOf(b64) !== 'png') return null;
  const head = Buffer.from(b64.slice(0, 44), 'base64'); // 33 bytes: signature + IHDR
  if (head.length < 24 || head.toString('latin1', 12, 16) !== 'IHDR') return null;
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

/** Jev image limits: 280-1568 px per side and 78,400-2,458,624 pixels in total. */
export function jevImageProblem(b64: string, name: string): string | null {
  const format = imageFormatOf(b64);
  if (!format) return `${name} is not a PNG or JPEG image`;
  if (format !== 'png') return null;
  const size = pngSize(b64);
  if (!size) return `${name} is not a readable PNG`;
  const { width, height } = size;
  if (width < 280 || height < 280 || width > 1568 || height > 1568) {
    return `${name} is ${width}x${height}; each side must be 280-1568 px (downscale the long side to 1568)`;
  }
  const px = width * height;
  if (px < 78_400 || px > 2_458_624) return `${name} has ${px} pixels; allowed 78,400-2,458,624`;
  return null;
}
