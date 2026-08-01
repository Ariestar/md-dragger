// Concrete optional DefaultUx modules. Hosts import from here and pass them via
// RuntimeOptions.ux.modules / mdDragger({ ux: { modules } }).
// Runtime core never imports this entry.
export { type AutoScrollConfig, autoScroll, type ScrollPort } from './auto-scroll';
