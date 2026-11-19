/**
 * WebAble in-page adaptation engine (engine.md). Public surface:
 *   Engine         - pure page module: extract, apply, verify, undo, layer
 *   ContentAdapter - messaging between the engine and the service worker,
 *                    and the engine side of Fit view (docs/10 §4): the
 *                    EngineApi fitview.js finds by symbol, the open flow,
 *                    tab mode, the in-page offer and the zoom guard
 */
export { Engine, mergePlans } from './engine';
export type {
  ApplyOptions,
  EngineEvents,
  EngineOptions,
  EnginePerf,
  VerifyReport,
} from './engine';
export {
  ContentAdapter,
  fitViewReason,
  isWorkerMessage,
  startOnce,
  unavailableLine,
} from './adapter';
export type { AdapterOptions, OpenOutcome, Transport } from './adapter';
export { ENGINE_API_KEY, FITVIEW_RUNTIME_KEY } from './fitview/types';
export type { EngineApi, FitViewRuntime } from './fitview/types';
export { isRouteHash, RouteWatcher } from './runtime/route';
export type { Extraction, PageFacts, VocabPort } from './types';
export { OPS, levelValue } from './ops/registry';
export { PREPAINT_FILES } from './ops/css';
