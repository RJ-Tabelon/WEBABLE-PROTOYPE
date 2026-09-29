/**
 * WebAble in-page adaptation engine (engine.md). Public surface:
 *   Engine         - pure page module: extract, apply, verify, undo, layer
 *   ContentAdapter - messaging between the engine and the service worker
 */
export { Engine, mergePlans } from './engine';
export type {
  ApplyOptions,
  EngineEvents,
  EngineOptions,
  EnginePerf,
  VerifyReport,
} from './engine';
export { ContentAdapter, isWorkerMessage } from './adapter';
export type { AdapterOptions, AnnounceStore, Transport } from './adapter';
export type { Extraction, PageFacts, VocabPort } from './types';
export { OPS, levelValue } from './ops/registry';
export { PREPAINT_FILES } from './ops/css';
