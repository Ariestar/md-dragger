// Concrete optional DefaultUx modules. Hosts import from here and pass them via
// RuntimeOptions.ux.modules / mdDragger({ ux: { modules } }).
// Runtime core never imports this entry.
export { autoScroll, type AutoScrollConfig, type ScrollPort } from './auto-scroll';
export { foldRestore, type FoldPort } from './fold-restore';
