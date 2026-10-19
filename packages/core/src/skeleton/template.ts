// Path shapes (docs/10 §5.1, §6): the part of a URL that names a page
// template, so one cache entry serves every page built from it.
//
//   https://www.youtube.com/watch?v=dQw4w9WgXcQ        /watch
//   https://www.youtube.com/@veritasium/videos         /@*/videos
//   https://www.youtube.com/results?search_query=x     /results
//   https://www.amazon.com/Some-Book/dp/B07XJ8C8F5     /*/dp/*
//   https://en.wikipedia.org/wiki/Alan_Turing          /wiki/*
//   https://www.reddit.com/r/books/comments/1q2w/what_to_read/
//                                                      /r/*/comments/*/*
//   https://app.example.com/#/settings/profile         /#/settings/profile
//
// A segment survives only when it looks like a route name: lowercase ASCII
// letters with at most two hyphens, up to 24 characters. Anything else
// (digits, ids, handles, capitalised titles, long slugs, encoded or non-ASCII
// text) becomes `*`, as does the segment after a one-letter namespace
// (/r/<name>, /u/<name>). The query never contributes, so search terms and ids
// in parameters are never part of a key. Hash routes (`#/...`, `#!/...`,
// `#name/...`) are shaped the same way and kept.

const ROUTE_WORD = /^[a-z][a-z-]{0,23}$/;
const EXTENSION = /\.(?:s?html?|php|aspx?|jsp|cgi)$/;
const MAX_SEGMENTS = 8;

function decode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function shapeSegments(raw: readonly string[]): string[] {
  const out: string[] = [];
  for (const [i, seg] of raw.entries()) {
    if (out.length >= MAX_SEGMENTS) {
      out.push('**');
      break;
    }
    const s = decode(seg).replace(EXTENSION, '');
    const prev = i > 0 ? raw[i - 1] : undefined;
    if (s.startsWith('@')) out.push('@*');
    else if (
      ROUTE_WORD.test(s) &&
      s.split('-').length <= 3 &&
      !s.endsWith('-') &&
      !(prev !== undefined && /^[a-z]$/.test(prev))
    )
      out.push(s);
    else out.push('*');
  }
  return out;
}

const segments = (path: string): string[] =>
  path.split('/').filter((s) => s.length > 0);

/** The template part of a URL's path (and hash route), never its query. '/' for anything unparsable. */
export function pathShape(url: string): string {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return '/';
  }
  let shape = `/${shapeSegments(segments(u.pathname)).join('/')}`;
  const hash = u.hash;
  const route = /^#(!?\/|[a-z][a-z-]*\/)/i.exec(hash);
  if (route) {
    const prefix = hash.startsWith('#!/') ? '#!' : '#';
    const body = hash.slice(prefix.length).split('?')[0] ?? '';
    const hashSegments = shapeSegments(segments(body));
    shape += `${shape.endsWith('/') ? '' : '/'}${prefix}/${hashSegments.join('/')}`;
  }
  return shape;
}
