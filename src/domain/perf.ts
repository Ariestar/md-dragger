// md-dragger/domain/perf — optional performance hooks.
//
// NOT part of the core domain surface: the package's own CodeMirror adapter
// never touches these. Only platforms doing deep perf tuning (telemetry,
// cache prewarming) need them. Kept on a separate entry point so a plain
// `import from 'md-dragger/domain'` stays clean.

export { setLineMapPerfRecorder, primeLineMapFromTransition } from './markdown/line-map';
export { setDetectBlockPerfRecorder } from './block/block-detector';
export { prewarmFenceScan } from './markdown/fence-scanner';
