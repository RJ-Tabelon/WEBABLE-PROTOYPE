import { readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { ENV_FILE } from './lib/paths.mjs';

/**
 * Minimal OpenAI Responses API client for the planner evaluation, streaming
 * so time to first token is measured as well as the whole exchange.
 *
 * The key is read from the repo's .env at call time and only ever placed in
 * the Authorization header: it is never printed, logged or written, and
 * error bodies are trimmed and stripped of anything key-shaped before they
 * are kept. A spend ledger (in the gitignored output folder) refuses calls
 * once the evaluation's budget is used.
 */

let cachedKey = null;

function apiKey() {
  if (cachedKey) return cachedKey;
  const txt = readFileSync(ENV_FILE, 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let v = m[1].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (v) {
      cachedKey = v;
      return v;
    }
  }
  throw new Error('OPENAI_API_KEY is not set in .env');
}

const scrub = (s) =>
  String(s ?? '')
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-…')
    .slice(0, 400);

/**
 * USD per 1M tokens: [input, cached input, output], standard tier (third-party
 * trackers, Oct 2026, as in the planner pilot). The priority tier is billed at
 * twice the standard rate.
 */
export const PRICE = {
  'gpt-6-sol': [2, 0.2, 10],
  'gpt-5.6-terra': [2, 0.2, 12],
};

export function costOf(model, usage, tier) {
  const p = PRICE[model];
  if (!p || !usage) return 0;
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const c =
    ((usage.input_tokens - cached) * p[0] +
      cached * p[1] +
      usage.output_tokens * p[2]) /
    1e6;
  return tier === 'priority' ? c * 2 : c;
}

export class Ledger {
  constructor(file, budgetUsd) {
    this.file = file;
    this.budget = budgetUsd;
    this.spent = 0;
    this.calls = 0;
  }

  async load() {
    try {
      const j = JSON.parse(await readFile(this.file, 'utf8'));
      this.spent = j.spent ?? 0;
      this.calls = j.calls ?? 0;
    } catch {
      // A fresh ledger.
    }
    return this;
  }

  async add(usd) {
    this.spent += usd;
    this.calls += 1;
    await mkdir(dirname(this.file), { recursive: true });
    await writeFile(
      this.file,
      JSON.stringify({ spent: this.spent, calls: this.calls }, null, 1),
    );
  }

  /** Room for one more call of about `next` dollars. */
  allows(next = 0.06) {
    return this.spent + next <= this.budget;
  }
}

/**
 * One Responses API call (streamed). `body` is plannerRequestBody's output.
 * Resolves (never rejects) with timing, usage, the output text and a cost.
 */
export async function respond(body, { timeoutMs = 30_000, ledger } = {}) {
  if (ledger && !ledger.allows())
    return { ok: false, err: 'budget', totalMs: 0, text: '', cost: 0 };
  const t0 = performance.now();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  let ttftMs = null;
  let ttfbMs = null;
  let text = '';
  let usage = null;
  let tier = null;
  let status = null;
  let respStatus = null;
  let err = null;
  let refusal = false;
  try {
    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ...body, stream: true }),
      signal: ctl.signal,
    });
    status = r.status;
    ttfbMs = performance.now() - t0;
    if (!r.ok) {
      err = scrub(await r.text());
    } else {
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const data = chunk
            .split('\n')
            .filter((l) => l.startsWith('data: '))
            .map((l) => l.slice(6))
            .join('');
          if (!data || data === '[DONE]') continue;
          let ev;
          try {
            ev = JSON.parse(data);
          } catch {
            continue;
          }
          if (ev.type === 'response.output_text.delta') {
            if (ttftMs === null) ttftMs = performance.now() - t0;
            text += ev.delta;
          } else if (ev.type === 'response.refusal.delta') {
            refusal = true;
          } else if (
            ev.type === 'response.completed' ||
            ev.type === 'response.incomplete' ||
            ev.type === 'response.failed'
          ) {
            usage = ev.response?.usage ?? null;
            tier = ev.response?.service_tier ?? null;
            respStatus = ev.response?.status ?? null;
            if (ev.type === 'response.failed')
              err = scrub(JSON.stringify(ev.response?.error ?? {}));
          } else if (ev.type === 'error') {
            err = scrub(JSON.stringify(ev));
          }
        }
      }
    }
  } catch (e) {
    err = scrub(e?.name === 'AbortError' ? 'timeout' : e?.message);
  } finally {
    clearTimeout(timer);
  }
  const totalMs = performance.now() - t0;
  const cost = costOf(body.model, usage, tier);
  if (ledger) await ledger.add(cost);
  return {
    ok: !err && respStatus === 'completed' && !refusal,
    status,
    respStatus,
    err,
    refusal,
    ttfbMs: ttfbMs === null ? null : Math.round(ttfbMs),
    ttftMs: ttftMs === null ? null : Math.round(ttftMs),
    totalMs: Math.round(totalMs),
    usage: usage
      ? {
          input: usage.input_tokens,
          cached: usage.input_tokens_details?.cached_tokens ?? 0,
          output: usage.output_tokens,
        }
      : null,
    tier,
    text,
    cost: Math.round(cost * 1e5) / 1e5,
  };
}
