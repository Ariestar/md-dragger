import type { DocEdit } from '../domain/transaction/block-transaction';
import type { BlockSelection } from '../domain/selection/block-selection';
import type { Doc } from '../domain/markdown/document-types';
import type { DropTarget } from '../domain/command/drop-target';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type { Change } from '../pipeline/drag-pipeline';

export type Disposable = () => void;

export type Point = {
    x: number;
    y: number;
};

export type Pointer = {
    id: number;
    type: string | null;
};

export type Modifiers = {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
};

export type TimerToken = ReturnType<typeof setTimeout>;

export type PressInput = {
    point: Point;
    pointer: Pointer;
    button?: number;
    modifiers?: Modifiers;
    native?: unknown;
    claim?: () => void;
    capture?: () => void;
    releaseCapture?: () => void;
};

export type MoveInput = {
    point: Point;
    pointer: Pointer;
    native?: unknown;
    claim?: () => void;
};

export type ReleaseInput = {
    point: Point;
    pointer: Pointer;
    native?: unknown;
    claim?: () => void;
    releaseCapture?: () => void;
};

export type CancelInput = {
    pointer: Pointer;
    reason: DragCancelReason;
    native?: unknown;
    releaseCapture?: () => void;
};

export type SelectionChangeInput = {
    point?: Point;
    lineNumber?: number;
    native?: unknown;
    claim?: () => void;
};

export type InputSource = {
    onPress: (handler: (input: PressInput) => void) => Disposable;
    onMove: (handler: (input: MoveInput) => void) => Disposable;
    onRelease: (handler: (input: ReleaseInput) => void) => Disposable;
    onCancel?: (handler: (input: CancelInput) => void) => Disposable;
    onEscape?: (handler: () => void) => Disposable;
};

// --- document axis (host -> rt, pull, read-only) ---

export type DocumentHost = {
    // The source document a drag originates from — the runtime's home doc.
    // The target document is NOT resolved here: it rides on each DropTarget
    // the locate axis produces, so cross-document drops need no extra host
    // method and no opt-in flag.
    getDoc(): Doc;
};

// --- locate axis (host -> rt, pull, coordinate translation) ---

export type LocateHost = {
    sourceLineFromInput(input: PressInput): number | null;
    resolveDropTarget(point: Point, context: { selection: BlockSelection }): DropTarget | null;
    // Map a live pointer position to a 1-indexed line number. Used by the
    // default gesture stage to drive range-select drawing from pointer moves.
    // Optional: a host that drives selection_change explicitly (via a custom
    // gesture stage passing lineNumber) can omit it.
    lineFromPoint?(point: Point): number | null;
};

// --- commit axis (rt -> host, hands back the edits to land) ---

// Re-exported so a CommitHost implementer gets the edit type from the same
// place as CommitHost itself.
export type { DocEdit } from '../domain/transaction/block-transaction';

// One DocEdit per affected document: a single edit for an in-file drop, two
// (source deletes, target inserts) for a cross-file drop. The host iterates
// and routes each to the view owning its doc — same shape either way.
export type CommitHost = {
    apply(edits: DocEdit[]): void;
};

// --- config ---

export type ResolvedConfig = {
    tabSize: number;
};

// A single `Config` that accepts either a partial object or a thunk; the
// runtime resolves it against defaults internally.
export type Config = Partial<ResolvedConfig> | (() => Partial<ResolvedConfig>);

// Gesture-recognition knobs for the default ux. These are NOT runtime-core
// concerns — the runtime is a platform-agnostic semantic orchestrator. They
// configure DefaultUx (the runtime's default gesture stage); a custom Ux may
// ignore them entirely. Declared here so the runtime re-exports the type
// alongside the other public types.
export type GestureConfig = {
    // Hold a handle this long before promoting the press. When multiSelectEnabled
    // is on, the long-press enters range-select submode; otherwise it promotes to
    // ready-to-drag (single-block drag). 0 = promote synchronously.
    longPressMs: number;
    // Pointer must move at least this far to start dragging (or to upgrade a
    // drawn range into a multi-block drag).
    dragStartMoveThresholdPx: number;
    // While still waiting for the long-press, moving more than this cancels the
    // press (treats it as a jitter/scroll, not a drag intent).
    dragCancelMoveThresholdPx: number;
    // When true, long-press on a handle enters range-select submode (draw a
    // multi-block range, then drag the whole range). When false, long-press goes
    // straight to ready-to-drag (single-block drag).
    multiSelectEnabled: boolean;
};

export type ResolvedGestureConfig = GestureConfig;

export const DEFAULT_GESTURE_CONFIG: ResolvedGestureConfig = {
    longPressMs: 250,
    dragStartMoveThresholdPx: 4,
    dragCancelMoveThresholdPx: 12,
    multiSelectEnabled: false,
};

// Injected timers, so the default ux's long-press timer is testable and
// destroyable rather than reaching for window.setTimeout directly.
export type SchedulerHost = {
    setTimer(callback: () => void, delayMs: number): TimerToken;
    clearTimer(token: TimerToken): void;
};

// A ux stage. The runtime ships a default (DefaultUx); a host that wants a
// different gesture model supplies its own. factory form lets the ux close over
// the runtime controller it will drive.
export type UxFactory = (controller: import('./dragger-runtime').RuntimeController) => Ux;

export type Ux = {
    mount(): void;
    destroy(): void;
};

// --- runtime options: IO axes ---

export type RuntimeOptions = {
    // Raw pointer source — consumed by the ux stage (default or custom), which
    // turns pointer events into semantic commands on the runtime.
    input: InputSource;
    document: DocumentHost;
    locate: LocateHost;
    commit: CommitHost;
    // Broadcast hook: every pipeline change (state transition + the event
    // that triggered it + outputs) is delivered here. This is the platform's
    // observation point — it projects ux (drop preview, selection highlight,
    // handle-tap, …) from `output`. Shallow: observe + derive, not intercept.
    onChange?(output: Change): void;
    config?: Config;
    // Gesture config for DefaultUx. Partial — the runtime merges it onto the
    // defaults. Ignored when `ux` is supplied.
    gestureConfig?: Partial<GestureConfig> | (() => Partial<GestureConfig>);
    // Timers for DefaultUx. Defaults to window.setTimeout/clearTimeout.
    scheduler?: SchedulerHost;
    // Custom ux stage. When omitted, the runtime uses DefaultUx (which needs
    // `input`, `locate.sourceLineFromInput`, `locate.lineFromPoint`, `document`,
    // `gestureConfig` and `scheduler`).
    ux?: UxFactory;
};

