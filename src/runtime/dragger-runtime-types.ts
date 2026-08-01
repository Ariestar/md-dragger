import type { DropPosition } from '../domain/command/drop-position';
import type { Doc } from '../domain/markdown/document-types';
import type { BlockSelection } from '../domain/selection/block-selection';
import type { DocEdit } from '../domain/transaction/block-transaction';
import type { Change } from '../pipeline/drag-pipeline';
import type { DragCancelReason } from '../pipeline/pipeline-event';

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
    /** Resolves structural drop position. */
    resolveDropPosition(point: Point, context: { selection: BlockSelection }): DropPosition | null;
    lineFromPoint?(point: Point): number | null;
};

export type { DocEdit } from '../domain/transaction/block-transaction';

export type CommitHost = {
    mode?: 'apply' | 'command';
    apply?(edits: DocEdit[]): void;
};

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

export type DefaultUxConfig = {
    gesture?: Partial<GestureConfig> | (() => Partial<GestureConfig>);
    modules?: readonly import('./ux-module').DefaultUxModule[];
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
