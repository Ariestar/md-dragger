import type { Block } from '../domain/block/block-types';
import type { DropPosition } from '../domain/command/drop-position';
import type { Doc } from '../domain/markdown/document-types';
import type { BlockSelection } from '../domain/selection/block-selection';
import type { DocEdit } from '../domain/transaction/block-transaction';
import type { Change } from '../pipeline/pipeline-reducer';
import type { DragCancelReason } from '../pipeline/pipeline-types';

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
    /** Escape keydown; the handler reports whether it consumed the key, so the
     * host only claims the event while a gesture is actually active. */
    onEscape?: (handler: () => boolean) => Disposable;
};

export type DocumentHost = {
    getDoc(): Doc;
};

export type LocateHost = {
    sourceLineFromInput(input: PressInput): number | null;
    /** Resolves structural drop position. */
    resolveDropPosition(point: Point, context: { selection: BlockSelection }): DropPosition | null;
    lineFromPoint?(point: Point): number | null;
};

export type { DocEdit } from '../domain/transaction/block-transaction';

export type CommitHost = {
    apply?(edits: DocEdit[]): void | Promise<void>;
};

/** Pointer identity — a gesture belongs to one pointer id. */
export function samePointer(a: Pointer, b: Pointer): boolean {
    return a.id === b.id;
}

/** True for thenables — host commits may resolve asynchronously. */
export function isPromiseLike<T>(value: T | Promise<T> | undefined): value is Promise<T> {
    return value !== undefined && typeof (value as Promise<T>).then === 'function';
}

export type ResolvedConfig = {
    tabSize: number;
    listIndentUnit: number;
};

export type Config = ResolvedConfig | (() => ResolvedConfig);

export type GestureConfig = {
    dragArmMs: number;
    multiSelectMs: number;
    dragStartMoveThresholdPx: number;
    dragCancelMoveThresholdPx: number;
    multiSelectEnabled: boolean;
};

export const DEFAULT_GESTURE_CONFIG: GestureConfig = {
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

export type DefaultUxConfig = {
    gesture?: Partial<GestureConfig> | (() => Partial<GestureConfig>);
    modules?: readonly import('./ux-module').DefaultUxModule[];
    selectionFromInput?: (input: PressInput, anchorBlock: Block) => BlockSelection | null;
};

export type PipelineResult = Change;

export type RuntimeOptions = {
    input: InputSource;
    document: DocumentHost;
    locate: LocateHost;
    commit: CommitHost;
    config: Config;
    scheduler?: SchedulerHost;
    ux?: UxFactory | DefaultUxConfig;
    onChange?: (result: PipelineResult) => void;
};
