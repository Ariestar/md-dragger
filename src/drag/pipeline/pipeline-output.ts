import type { ListDropTarget } from '../../domain/command/drop-target';
import type { BlockCommand } from '../../domain/command/block-command';
import type { BlockSelection } from '../../domain/selection/block-selection';
import type { DragCancelReason } from './pipeline-event';
import type { DragDropSnapshot } from './pipeline-drop';
import type { PipelineState } from './pipeline-state';

export type DragSessionPhase =
    | 'idle'
    | 'press_pending'
    | 'drag_active'
    | 'drop_commit'
    | 'cancelled';

export type DragLifecycleEvent =
    | DragIdleLifecycleEvent
    | DragPressPendingLifecycleEvent
    | DragStartedLifecycleEvent
    | DragTargetChangedLifecycleEvent
    | DragDropCommitLifecycleEvent
    | DragCancelledLifecycleEvent;

export interface DragIdleLifecycleEvent {
    type: 'drag_idle';
    phase: 'idle';
    source: null;
    targetLine: null;
    listIntent: null;
    rejectReason: null;
    pointerType: null;
}

export interface DragPressPendingLifecycleEvent {
    type: 'drag_press_pending';
    phase: 'press_pending';
    source: BlockSelection;
    targetLine: null;
    listIntent: null;
    rejectReason: null;
    pointerType: string | null;
    pressReady: boolean;
}

export interface DragStartedLifecycleEvent {
    type: 'drag_started';
    phase: 'drag_active';
    source: BlockSelection;
    targetLine: null;
    listIntent: null;
    rejectReason: null;
    pointerType: string | null;
}

export interface DragTargetChangedLifecycleEvent {
    type: 'drag_target_changed';
    phase: 'drag_active';
    source: BlockSelection;
    targetLine: number | null;
    listIntent: ListDropTarget | null;
    rejectReason: string | null;
    pointerType: string | null;
}

export interface DragDropCommitLifecycleEvent {
    type: 'drag_drop_commit';
    phase: 'drop_commit';
    source: BlockSelection;
    targetLine: number | null;
    listIntent: ListDropTarget | null;
    rejectReason: null;
    pointerType: string | null;
}

export interface DragCancelledLifecycleEvent {
    type: 'drag_cancelled';
    phase: 'cancelled';
    source: BlockSelection | null;
    targetLine: number | null;
    listIntent: ListDropTarget | null;
    rejectReason: string;
    pointerType: string | null;
}

export type DragLifecycleListener = (event: DragLifecycleEvent) => void;

export type PipelineOutput<TPreview = unknown> =
    | { type: 'state_changed'; state: PipelineState }
    | { type: 'selection_changed'; selection: BlockSelection | null }
    | { type: 'drag_source_changed'; selection: BlockSelection | null }
    | { type: 'drag_over'; selection: BlockSelection; drop: DragDropSnapshot<TPreview>; pointerType: string | null }
    | { type: 'dropped'; selection: BlockSelection; drop: DragDropSnapshot<TPreview>; pointerType: string | null }
    | { type: 'cancelled'; selection: BlockSelection | null; reason: DragCancelReason; pointerType: string | null }
    | { type: 'command_ready'; command: BlockCommand }
    | { type: 'terminal'; reason: 'drop' | 'cancel' | 'destroy' | 'guard_unavailable' }
    | { type: 'lifecycle'; event: DragLifecycleEvent };

export function buildPressPendingLifecycleEvent(
    source: BlockSelection,
    pointerType: string | null,
    pressReady: boolean
): DragLifecycleEvent {
    return {
        type: 'drag_press_pending',
        phase: 'press_pending',
        source,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType,
        pressReady,
    };
}

export function buildDragStartedLifecycleEvent(
    source: BlockSelection,
    pointerType: string | null
): DragLifecycleEvent {
    return {
        type: 'drag_started',
        phase: 'drag_active',
        source,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType,
    };
}

export function buildDragTargetChangedLifecycleEvent(params: {
    source: BlockSelection;
    targetLine: number | null;
    listIntent: ListDropTarget | null;
    rejectReason: string | null;
    pointerType: string | null;
}): DragLifecycleEvent {
    return {
        type: 'drag_target_changed',
        phase: 'drag_active',
        source: params.source,
        targetLine: params.targetLine,
        listIntent: params.listIntent,
        rejectReason: params.rejectReason,
        pointerType: params.pointerType,
    };
}

export function buildDropCommitLifecycleEvent(params: {
    source: BlockSelection;
    targetLine: number | null;
    listIntent: ListDropTarget | null;
    pointerType: string | null;
}): DragLifecycleEvent {
    return {
        type: 'drag_drop_commit',
        phase: 'drop_commit',
        source: params.source,
        targetLine: params.targetLine,
        listIntent: params.listIntent,
        rejectReason: null,
        pointerType: params.pointerType,
    };
}

export function buildCancelledLifecycleEvent(params: {
    source: BlockSelection | null;
    targetLine?: number | null;
    listIntent?: ListDropTarget | null;
    rejectReason: string;
    pointerType: string | null;
}): DragLifecycleEvent {
    return {
        type: 'drag_cancelled',
        phase: 'cancelled',
        source: params.source,
        targetLine: params.targetLine ?? null,
        listIntent: params.listIntent ?? null,
        rejectReason: params.rejectReason,
        pointerType: params.pointerType,
    };
}

export function buildIdleLifecycleEvent(): DragLifecycleEvent {
    return {
        type: 'drag_idle',
        phase: 'idle',
        source: null,
        targetLine: null,
        listIntent: null,
        rejectReason: null,
        pointerType: null,
    };
}
