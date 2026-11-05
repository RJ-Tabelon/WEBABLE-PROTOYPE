// The WebAble logo stays in the bottom-right launcher; its pieces queue while content is being adapted.
import type { EngineState } from '../../contracts';
import { Logo } from '../Logo';
import { changedHere, sheetMode } from './model';

export function WaButton({ s, origin, open, onToggle }: { s: EngineState; origin: string; open: boolean; onToggle: () => void }) {
  const mode = sheetMode(s, origin);
  const changed = mode === 'on' && changedHere(s);
  const working = mode === 'on' && Boolean(
    (s.pendingWork ?? 0) > 0 || s.phase === 'reading' || s.calm.loading ||
    s.reword?.status === 'scoring' || s.reword?.status === 'writing' || s.compose?.status === 'working',
  );
  const label = open
    ? 'Close WebAble'
    : mode === 'paused'
      ? 'WebAble, paused on this site'
      : mode === 'off'
        ? 'WebAble, turned off'
        : working
          ? 'WebAble, adapting this page'
          : changed
            ? 'WebAble, changed this page for you'
            : 'WebAble';
  return (
    <button
      class="wa-fab"
      data-wa-chrome=""
      data-changed={changed ? '' : undefined}
      data-state={mode}
      data-working={working ? '' : undefined}
      aria-expanded={open}
      aria-label={label}
      title={`${label} (Alt+W)`}
      onClick={onToggle}
    >
      <Logo size={32} active={working} />
    </button>
  );
}
