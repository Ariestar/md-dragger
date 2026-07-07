import type { TextChange, BlockEffect } from '../domain/transaction/block-transaction';
import type { BlockSelection } from '../domain/selection/block-selection';
import type { DocLikeWithRange } from '../domain/markdown/document-types';
import type { DropTarget } from '../domain/command/drop-target';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type { Transition } from '../pipeline/drag-pipeline';

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
    getDoc(): DocLikeWithRange;
};

// --- locate axis (host -> rt, pull, coordinate translation) ---

export type LocateHost = {
    sourceLineFromInput(input: PressInput): number | null;
    resolveDropTarget(point: Point, context: { selection: BlockSelection }): DropTarget | null;
};

// --- commit axis (rt -> host, hands back the whole transaction) ---

// Structurally equivalent to the domain transaction shape, but defined here so
// headless runtime code never couples to the domain transaction type identity.
export type DropCommit = {
    changes: TextChange[];
    effects?: BlockEffect[];
    selectionAfter?: BlockSelection | null;
};

export type DropCommitContext = {
    selection: BlockSelection;
    target: DropTarget;
};

export type CommitHost = {
    apply(commit: DropCommit, context: DropCommitContext): void;
};

// --- broadcast axis (rt -> host, single source of truth) ---

export type OutputHost = {
    // Single source of truth: every pipeline transition, verbatim.
    // All derived views (drop preview, selection highlight, ...) are the
    // platform's job — it projects them from transition.outputs itself.
    onResult?(transition: Transition): void;
};

// --- scheduler axis (injected timers) ---

export type SchedulerHost = {
    setTimer(callback: () => void, delayMs: number): TimerToken;
    clearTimer(token: TimerToken): void;
};

// --- config ---

export type ResolvedConfig = {
    tabSize: number;
    longPressMs: number;
    dragStartMoveThresholdPx: number;
    dragCancelMoveThresholdPx: number;
};

// A single `Config` name that accepts either a partial object or a thunk;
// the runtime resolves it against defaults internally.
export type Config = Partial<ResolvedConfig> | (() => Partial<ResolvedConfig>);

// --- input stage (gesture recognition + input wiring, swappable) ---

export type RuntimeController = {
    readonly input: InputSource;
    handlePress(input: PressInput): void;
    handleMove(input: MoveInput): void;
    handleRelease(input: ReleaseInput): void;
    handleCancel(pointer: Pointer, releaseCapture?: () => void): void;
    handleSelectionChange(input: SelectionChangeInput): void;
    finishSelection(): void;
    clearSelectionOrCancel(): void;
};

export type RuntimeUx = {
    mount(runtime: RuntimeController): Disposable | void;
};

export type UxOption =
    | 'default'
    | 'none'
    | RuntimeUx
    | (() => RuntimeUx);

// --- runtime options: five fixed IO axes + a swappable input stage ---

export type RuntimeOptions = {
    input: InputSource;
    document: DocumentHost;
    locate: LocateHost;
    commit: CommitHost;
    output?: OutputHost;
    scheduler?: SchedulerHost;
    ux?: UxOption;
    config?: Config;
};
