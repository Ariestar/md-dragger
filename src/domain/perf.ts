// md-dragger/domain/perf — optional performance hooks.
//
// Not part of the core domain surface. Only hosts doing deep perf tuning
// (telemetry, cache prewarming) need them. Separate entry so a plain
// `import from 'md-dragger/domain'` stays clean.

export { setLineMapPerfRecorder, primeLineMapFromTransition } from './markdown/line-map';
export { setDetectBlockPerfRecorder } from './block/block-detector';
export { prewarmFenceScan } from './markdown/fence-scanner';
