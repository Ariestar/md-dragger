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

export type InputSource = {
    onPress: (handler: (input: PressInput) => void) => Disposable;
    onMove: (handler: (input: MoveInput) => void) => Disposable;
    onRelease: (handler: (input: ReleaseInput) => void) => Disposable;
    onCancel?: (handler: (input: CancelInput) => void) => Disposable;
    onEscape?: (handler: () => void) => Disposable;
};

// --- document axis (host -> rt, pull, read-only) ---

export type DocumentHost = {
    // Source document a drag originates from. Target docs ride on each
    // DropTarget from the locate axis — no separate host method needed.
    getDoc(): Doc;
};

// --- locate axis (host -> rt, pull, coordinate translation) ---

export type LocateHost = {
    sourceLineFromInput(input: PressInput): number | null;
    resolveDropTarget(point: Point, context: { selection: BlockSelection }): DropTarget | null;
    // Map a live pointer position to a 1-indexed line number (DefaultUx range-select).
    lineFromPoint?(point: Point): number | null;
};

// --- commit axis (rt -> host) ---

export type { DocEdit } from '../domain/transaction/block-transaction';

// apply (default): runtime plans the move, emits platform_commit, then calls apply(edits).
// command: runtime plans the move, emits command_ready + dropped, does not mutate the doc.
// Hosts that own their own transaction/history system use command mode and apply from
// the command_ready output.
export type CommitHost = {
    mode?: 'apply' | 'command';
    apply?(edits: DocEdit[]): void;
};

// --- config ---

export type ResolvedConfig = {
    tabSize: number;
};

export type Config = Partial<ResolvedConfig> | (() => Partial<ResolvedConfig>);

// Gesture knobs for DefaultUx only. Runtime core is platform-agnostic; a custom
// Ux may ignore these entirely.
export type GestureConfig = {
    longPressMs: number;
    dragStartMoveThresholdPx: number;
    dragCancelMoveThresholdPx: number;
    multiSelectEnabled: boolean;
};

export type ResolvedGestureConfig = GestureConfig;

export const DEFAULT_GESTURE_CONFIG: ResolvedGestureConfig = {
    longPressMs: 250,
    dragStartMoveThresholdPx: 4,
    dragCancelMoveThresholdPx: 12,
    multiSelectEnabled: false,
};

export type SchedulerHost = {
    setTimer(callback: () => void, delayMs: number): TimerToken;
    clearTimer(token: TimerToken): void;
};

export type UxFactory = (controller: import('./dragger-runtime').RuntimeController) => Ux;

export type Ux = {
    mount(): void;
    destroy(): void;
};

// Full pipeline transition: previous/current state + outputs + triggering event.
// This is the runtime's primary observation surface — not a second event system.
export type PipelineResult = Change;

export type RuntimeOptions = {
    input: InputSource;
    document: DocumentHost;
    locate: LocateHost;
    commit: CommitHost;
    // Primary output. Every pipeline.enter result lands here intact.
    onChange?(result: PipelineResult): void;
    config?: Config;
    gestureConfig?: Partial<GestureConfig> | (() => Partial<GestureConfig>);
    scheduler?: SchedulerHost;
    ux?: UxFactory;
};
