import type { EditorView } from '@codemirror/view';
import type { BlockSelection, DropPosition } from '../../domain';
import type {
    CommitHost,
    Config,
    DefaultUxConfig,
    LocateHost,
    PipelineResult,
    Point,
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
    /** Gutter side — "before" (left, default) or "after" (right of content). */
    side?: 'before' | 'after';
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

export type ExternalTargetOptions = {
    resolveDropPosition(point: Point, context: { selection: BlockSelection }): DropPosition | null | undefined;
};

export type ExternalTargetOptionInput = ExternalTargetOptions | ((view: EditorView) => ExternalTargetOptions);

export type UxOptionInput = DefaultUxConfig | ((view: EditorView) => DefaultUxConfig);

export type CommitOptions = CommitHost;
export type CommitOptionInput = CommitOptions | ((view: EditorView) => CommitOptions);

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
    externalTarget?: ExternalTargetOptionInput;
    commit?: CommitOptionInput;
    // Extra host observer for pipeline output (in addition to dragTransitionEffect).
    onChange?: (result: PipelineResult) => void;
    // DefaultUx settings (gesture knobs + optional modules). Forwarded to Runtime.
    ux?: UxOptionInput;
    // Views where the dragger must stay dormant (no handles, no drags) — e.g.
    // Obsidian's nested table-cell editor. Called with the live view; hosts
    // should keep the predicate cheap and DOM-based, and the adapter re-checks
    // it per render/press because such editors are mounted detached and only
    // become identifiable once attached.
    enabled?: (view: EditorView) => boolean;
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

/** Resolve a static option value or a per-view factory against the live view. */
export function resolvePerView<T>(option: T | ((view: EditorView) => T) | undefined, view: EditorView): T | undefined {
    if (option === undefined) return undefined;
    // TS cannot call a narrowed generic union; the function branch is the
    // factory by construction.
    return typeof option === 'function' ? (option as (view: EditorView) => T)(view) : option;
}

export function isDraggerEnabled(options: Pick<MdDraggerCodeMirrorOptions, 'enabled'>, view: EditorView): boolean {
    return options.enabled ? options.enabled(view) : true;
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
    // Zero is a valid "no nesting" offset (single-level lists have no step to
    // measure); only reject negative or non-finite values, which are always
    // configuration errors.
    if (!Number.isFinite(raw) || raw < 0) {
        throw new Error(`mdDragger: listIndentWidthPx must be a finite non-negative number, got ${String(raw)}`);
    }
    return raw;
}
