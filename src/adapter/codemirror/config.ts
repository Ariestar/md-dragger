import type { Config } from '../../runtime';

export const HANDLE_CLASS = 'md-dragger-cm-handle';
export const EDITOR_CLASS = 'md-dragger-cm-editor';
export const LIST_INTENT_THRESHOLD_PX = 24;

// Custom handle element factory. Returns the DOM element used for every
// draggable block's handle. The same element shape is reused across blocks;
// per-block state (e.g. data attributes) is the consumer's to set elsewhere.
// The default is a plain ⋮⋮ button.
export type RenderHandle = () => HTMLElement;

export type HandleOptions = {
  render?: RenderHandle;
};

export type MdDraggerCodeMirrorOptions = {
  config?: Config;
  handle?: HandleOptions;
};

export function resolveConfig(config: Config | undefined) {
  return typeof config === 'function' ? config() : config;
}

export function resolveTabSize(options: MdDraggerCodeMirrorOptions): number {
  return resolveConfig(options.config)?.tabSize ?? 4;
}
