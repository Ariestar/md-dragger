import type { EditorView } from '@codemirror/view';
import type {
  Config,
  DefaultUxConfig,
  LocateHost,
  PipelineResult,
  ResolvedConfig,
} from '../../runtime';

export const HANDLE_CLASS = 'md-dragger-handle';
export const EDITOR_CLASS = 'md-dragger-editor';

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
  // Required: tabSize + listIndentUnit. No silent defaults.
  config: Config;
  handle?: HandleOptions;
  locate?: LocateOptionInput;
  // Extra host observer for pipeline output (in addition to dragTransitionEffect).
  onChange?: (result: PipelineResult) => void;
  // DefaultUx settings (gesture knobs + optional modules). Forwarded to Runtime.
  ux?: DefaultUxConfig;
};

export function resolveConfig(config: Config): ResolvedConfig {
  const raw = typeof config === 'function' ? config() : config;
  if (!(raw.tabSize > 0)) {
    throw new Error(`mdDragger: config.tabSize must be positive, got ${String(raw.tabSize)}`);
  }
  if (!(raw.listIndentUnit > 0)) {
    throw new Error(`mdDragger: config.listIndentUnit must be positive, got ${String(raw.listIndentUnit)}`);
  }
  return raw;
}

export function resolveLocateOptions(
  locate: LocateOptionInput | undefined,
  view: EditorView,
): LocateOptions | undefined {
  if (!locate) return undefined;
  return typeof locate === 'function' ? locate(view) : locate;
}

export function resolveTabSize(options: MdDraggerCodeMirrorOptions): number {
  return resolveConfig(options.config).tabSize;
}

export function resolveListIndentUnit(options: MdDraggerCodeMirrorOptions): number {
  return resolveConfig(options.config).listIndentUnit;
}
