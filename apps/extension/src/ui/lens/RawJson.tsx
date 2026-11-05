// Owner: D2. Jev's typed answers as highlighted JSON (built as nodes, never innerHTML).
import type { ComponentChildren } from 'preact';
import { useMemo } from 'preact/hooks';

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;

function round(_k: string, v: unknown): unknown {
  return typeof v === 'number' && !Number.isInteger(v) ? Math.round(v * 1_000_000) / 1_000_000 : v;
}

export function RawJson(props: { value: unknown; maxChars?: number }) {
  const nodes = useMemo(() => {
    let text = '';
    try {
      text = JSON.stringify(props.value, round, 2) ?? 'null';
    } catch {
      text = '"(could not serialise)"';
    }
    const max = props.maxChars ?? 120_000;
    const clipped = text.length > max;
    if (clipped) text = text.slice(0, max);
    const out: ComponentChildren[] = [];
    let last = 0;
    let k = 0;
    TOKEN.lastIndex = 0;
    for (let m = TOKEN.exec(text); m; m = TOKEN.exec(text)) {
      if (m.index > last) out.push(text.slice(last, m.index));
      if (m[1] !== undefined) {
        if (m[2] !== undefined) {
          out.push(<span key={k++} class="wa-j-key">{m[1]}</span>);
          out.push(m[2]);
        } else {
          out.push(<span key={k++} class="wa-j-str">{m[1]}</span>);
        }
      } else if (m[3] !== undefined) {
        out.push(<span key={k++} class="wa-j-num">{m[3]}</span>);
      } else if (m[4] !== undefined) {
        out.push(<span key={k++} class="wa-j-lit">{m[4]}</span>);
      }
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    if (clipped) out.push('\n…');
    return out;
  }, [props.value, props.maxChars]);
  return <pre class="wa-json">{nodes}</pre>;
}
