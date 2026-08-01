import type { EditorView } from '@codemirror/view';
import type { Config, DefaultUxConfig, LocateHost, PipelineResult, ResolvedConfig } from '../../runtime';

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
// sourceLineFromInput / resolveDropPosition without forking the runtime.
export type LocateOptions = {
    sourceLineFromInput?: LocateHost['sourceLineFromInput'];
    resolveDropPosition?: LocateHost['resolveDropPosition'];
    lineFromPoint?: LocateHost['lineFromPoint'];
};

// Static overrides, or a factory that closes over the live EditorView
// (needed for row-as-handle, custom hit-testing, …).
export type LocateOptionInput = LocateOptions | ((view: EditorView) => LocateOptions);

// Rendered pixel width of one list nesting level. Host-owned rendering
// knowledge (theme CSS): ink-mde 2rem, Obsidian --list-indent, …
export type ListIndentWidthPx = number | ((view: EditorView) => number);

export type MdDraggerCodeMirrorOptions = {
    // Required: tabSize + listIndentUnit. No silent defaults.
    config: Config;
    // Required: pixel width of one rendered list nesting level (x-axis drag step).
    listIndentWidthPx: ListIndentWidthPx;
    handle?: HandleOptions;
    locate?: LocateOptionInput;
    // Extra host observer for pipeline output (in addition to dragTransitionEffect).
    onChange?: (result: PipelineResult) => void;
    // DefaultUx settings (gesture knobs + optional modules). Forwarded to Runtime.
    ux?: DefaultUxConfig;
};

// Geometry needs only the structural config plus the rendered indent step.
// Shared by the adapter geometry module and consumer paint extensions.
export type CodeMirrorGeometryOptions = Pick<MdDraggerCodeMirrorOptions, 'config' | 'listIndentWidthPx'>;

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

export function resolveTabSize(options: Pick<MdDraggerCodeMirrorOptions, 'config'>): number {
    return resolveConfig(options.config).tabSize;
}

export function resolveListIndentUnit(options: Pick<MdDraggerCodeMirrorOptions, 'config'>): number {
    return resolveConfig(options.config).listIndentUnit;
}

export function resolveListIndentWidthPx(
    options: Pick<MdDraggerCodeMirrorOptions, 'listIndentWidthPx'>,
    view: EditorView,
): number {
    const raw =
        typeof options.listIndentWidthPx === 'function' ? options.listIndentWidthPx(view) : options.listIndentWidthPx;
    if (!Number.isFinite(raw) || !(raw > 0)) {
        throw new Error(`mdDragger: listIndentWidthPx must be a positive finite number, got ${String(raw)}`);
    }
    return raw;
}
