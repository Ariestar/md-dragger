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

export type DocumentHost = {
    getDoc(): Doc;
};

export type LocateHost = {
    sourceLineFromInput(input: PressInput): number | null;
    resolveDropTarget(point: Point, context: { selection: BlockSelection }): DropTarget | null;
    lineFromPoint?(point: Point): number | null;
};

export type { DocEdit } from '../domain/transaction/block-transaction';

export type CommitHost = {
    mode?: 'apply' | 'command';
    apply?(edits: DocEdit[]): void;
};

// Host must supply both. No silent defaults.
export type ResolvedConfig = {
    tabSize: number;
    /** Columns per one list nest step (e.g. 2 for common markdown lists). */
    listIndentUnit: number;
};

export type Config = ResolvedConfig | (() => ResolvedConfig);

// Gesture knobs for DefaultUx only.
//
// Timing ladder (multiSelectEnabled):
//   short release before multiSelectMs → press_cancelled (host may open a menu)
//   hold to dragArmMs → ready_to_drag (move past threshold starts a drag)
//   hold to multiSelectMs → selecting (persistent multi-select)
//
// dragArmMs = 0 means a move past threshold can start a drag immediately after
// press (desktop). multiSelectMs is ignored when multiSelectEnabled is false.
export type GestureConfig = {
    dragArmMs: number;
    multiSelectMs: number;
    dragStartMoveThresholdPx: number;
    dragCancelMoveThresholdPx: number;
    multiSelectEnabled: boolean;
};

export type ResolvedGestureConfig = GestureConfig;

export const DEFAULT_GESTURE_CONFIG: ResolvedGestureConfig = {
    dragArmMs: 0,
    multiSelectMs: 500,
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

// Settings for the built-in DefaultUx. Runtime does not interpret these itself —
// it only forwards them when constructing DefaultUx.
// Omit the whole object, or any field, to use defaults:
//   gesture → DEFAULT_GESTURE_CONFIG
//   modules → []
export type DefaultUxConfig = {
    gesture?: Partial<GestureConfig> | (() => Partial<GestureConfig>);
    // Optional capabilities (auto-scroll, fold-restore, …). Host builds the list.
    modules?: readonly import('./ux-module').DefaultUxModule[];
};

export type PipelineResult = Change;

export type RuntimeOptions = {
    input: InputSource;
    document: DocumentHost;
    locate: LocateHost;
    commit: CommitHost;
    // Required: tabSize + listIndentUnit. Missing values throw.
    config: Config;
    onChange?(result: PipelineResult): void;
    scheduler?: SchedulerHost;
    // Omit = DefaultUx with default gesture + no modules.
    // Object = DefaultUx config. Function = full Ux replacement.
    ux?: DefaultUxConfig | UxFactory;
};
