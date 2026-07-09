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
    longPressMs: number;
    dragStartMoveThresholdPx: number;
    dragCancelMoveThresholdPx: number;
};

// A single `Config` that accepts either a partial object or a thunk; the
// runtime resolves it against defaults internally.
export type Config = Partial<ResolvedConfig> | (() => Partial<ResolvedConfig>);

// --- runtime options: IO axes ---

export type RuntimeOptions = {
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
};
