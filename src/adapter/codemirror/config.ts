import type { EditorView } from '@codemirror/view';
import type { Config, GestureConfig, LocateHost, PipelineResult } from '../../runtime';

export const HANDLE_CLASS = 'md-dragger-cm-handle';
export const EDITOR_CLASS = 'md-dragger-cm-editor';

// Custom handle element factory. Returns the DOM element used for every
// draggable block's handle. The same element shape is reused across blocks;
// per-block state (e.g. data attributes) is the consumer's to set elsewhere.
// The default is a plain ⋮⋮ button.
export type RenderHandle = () => HTMLElement;

export type HandleOptions = {
  render?: RenderHandle;
};

// Host-owned locate overrides. Default adapter only arms on the handle;
// a consumer (web playground, Obsidian mobile mode, …) can replace
// sourceLineFromInput / resolveDropTarget without forking the runtime.
export type LocateOptions = {
  sourceLineFromInput?: LocateHost['sourceLineFromInput'];
  resolveDropTarget?: LocateHost['resolveDropTarget'];
  lineFromPoint?: LocateHost['lineFromPoint'];
};

// Static overrides, or a factory that closes over the live EditorView
// (needed for row-as-handle, custom hit-testing, …).
export type LocateOptionInput = LocateOptions | ((view: EditorView) => LocateOptions);

export type MdDraggerCodeMirrorOptions = {
  config?: Config;
  handle?: HandleOptions;
  locate?: LocateOptionInput;
  // Extra host observer for pipeline output (in addition to dragTransitionEffect).
  onChange?: (result: PipelineResult) => void;
  // Gesture config for the runtime's default ux (long-press ms, thresholds,
  // multi-select toggle). Partial — merged onto the defaults. Omit for defaults.
  gestureConfig?: Partial<GestureConfig> | (() => Partial<GestureConfig>);
};

export function resolveConfig(config: Config | undefined) {
  return typeof config === 'function' ? config() : config;
}

export function resolveGestureConfig(gestureConfig: MdDraggerCodeMirrorOptions['gestureConfig']) {
  return typeof gestureConfig === 'function' ? gestureConfig() : gestureConfig;
}

export function resolveLocateOptions(
  locate: LocateOptionInput | undefined,
  view: EditorView,
): LocateOptions | undefined {
  if (!locate) return undefined;
  return typeof locate === 'function' ? locate(view) : locate;
}

export function resolveTabSize(options: MdDraggerCodeMirrorOptions): number {
  return resolveConfig(options.config)?.tabSize ?? 4;
}