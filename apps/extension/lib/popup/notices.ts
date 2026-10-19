import type { PopupStatus } from '../protocol';
import { chromeArea, getOne, type KvArea } from '../storage/area';
import { isRecord } from '../storage/store';
import { KEYS } from '../storage/keys';
import type { TabDetail } from '../sw/ui';

/**
 * One-time notices in the popup, shown until the person dismisses them. The
 * dismissals are the one thing the popup writes to storage itself: a note
 * about WebAble's own screen, not learning state, so the worker never reads
 * them. Every read and write resolves, and a failure only means the notice
 * shows again next time.
 */

export type NoticeId = 'fit_view';

/** States where the page is WebAble's to change and the person is past first run. */
const SETTLED: ReadonlySet<PopupStatus> = new Set([
  'adapted',
  'nothing_to_change',
  'all_undone',
]);

/**
 * The v2 notice (docs/10 §8): the first time the popup opens on a page
 * WebAble has finished with, or the first time Fit view can show the page.
 * Never on first run, which has its own introduction.
 */
export function wantsFitViewNotice(
  view: Pick<TabDetail, 'status' | 'fitView' | 'account'>,
): boolean {
  if (view.status === 'first_run' || view.account.needsReauth) return false;
  return SETTLED.has(view.status) || view.fitView?.available === true;
}

/** The notices the person dismissed on this device. */
export async function dismissedNotices(
  area: KvArea = chromeArea('local'),
): Promise<Set<NoticeId>> {
  try {
    const raw = await getOne(area, KEYS.notices);
    if (!isRecord(raw)) return new Set();
    return new Set(
      Object.keys(raw).filter((id): id is NoticeId => id === 'fit_view'),
    );
  } catch {
    return new Set();
  }
}

export async function dismissNotice(
  id: NoticeId,
  area: KvArea = chromeArea('local'),
  now: number = Date.now(),
): Promise<void> {
  try {
    const raw = await getOne(area, KEYS.notices);
    await area.set({
      [KEYS.notices]: { ...(isRecord(raw) ? raw : {}), [id]: now },
    });
  } catch {
    // Shown again next time; nothing else depends on it.
  }
}
