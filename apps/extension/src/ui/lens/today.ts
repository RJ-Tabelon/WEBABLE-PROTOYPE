// Owner: D2. "Today: N decisions · $X" session meter, kept in chrome.storage.local under `todayMeter`.
import { useEffect, useState } from 'preact/hooks';
import type { JevMetrics } from '@webable/core';
import type { EngineState } from '../../contracts';
import { jevMetricsList } from '../panel/format';

export const TODAY_KEY = 'todayMeter';
export interface TodayMeter { day: string; decisions: number; usd: number; pages: number }

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function area(): chrome.storage.StorageArea | null {
  try {
    return typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local ? chrome.storage.local : null;
  } catch {
    return null;
  }
}

export async function readToday(): Promise<TodayMeter> {
  const fresh: TodayMeter = { day: today(), decisions: 0, usd: 0, pages: 0 };
  const a = area();
  if (!a) return fresh;
  try {
    const got = await a.get(TODAY_KEY);
    const v = got[TODAY_KEY] as Partial<TodayMeter> | undefined;
    if (!v || v.day !== fresh.day) return fresh;
    return { day: fresh.day, decisions: Number(v.decisions) || 0, usd: Number(v.usd) || 0, pages: Number(v.pages) || 0 };
  } catch {
    return fresh;
  }
}

const counted = new WeakSet<JevMetrics>();
let queue: Promise<void> = Promise.resolve();

function addToToday(decisions: number, usd: number, page: boolean): Promise<void> {
  queue = queue.then(async () => {
    const a = area();
    if (!a) return;
    const cur = await readToday();
    const next: TodayMeter = {
      day: cur.day,
      decisions: cur.decisions + decisions,
      usd: cur.usd + usd,
      pages: cur.pages + (page ? 1 : 0),
    };
    try {
      await a.set({ [TODAY_KEY]: next });
    } catch {
      /* storage unavailable: the meter just stays local */
    }
  }).catch(() => {});
  return queue;
}

/** Adds every new Jev metrics object once, and returns the running day total. */
export function useTodayMeter(s: EngineState): TodayMeter | null {
  const [meter, setMeter] = useState<TodayMeter | null>(null);
  const list = jevMetricsList(s);
  const fresh = list.filter((m) => !counted.has(m));
  const key = fresh.length;
  useEffect(() => {
    let alive = true;
    const run = async () => {
      if (fresh.length) {
        let d = 0;
        let usd = 0;
        let page = false;
        for (const m of fresh) {
          counted.add(m);
          // Cached answers cost nothing the second time; count only what Jev actually answered.
          if (m === s.understanding?.metrics && s.understanding?.cached) continue;
          d += Number(m.questions) || 0;
          usd += Number(m.costUsd) || 0;
          if (m === s.understanding?.metrics) page = true;
        }
        if (d > 0 || usd > 0) await addToToday(d, usd, page);
      }
      const v = await readToday();
      if (alive) setMeter(v);
    };
    void run();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, s.understanding]);
  return meter;
}
