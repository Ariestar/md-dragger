import type { DragCancelReason, GuardId } from './pipeline-event';
import { buildIdleLifecycleEvent, type PipelineOutput } from './pipeline-output';
import { cancelDrop, type DragDropSnapshot } from './pipeline-drop';
import { dependsOnGuard } from './pipeline-guard';
import { IDLE_PIPELINE_STATE, type PipelineState } from './pipeline-state';

export type PipelineExitResult<TPreview = unknown> = {
    state: PipelineState;
    outputs: PipelineOutput<TPreview>[];
};

export function cancelPipeline<TPreview>(
    state: PipelineState,
    reason: DragCancelReason,
    pointerType: string | null
): PipelineExitResult<TPreview> {
    if (state.type === 'idle') {
        return { state, outputs: [] };
    }

    if (
        reason !== 'guard_unavailable'
        && (state.type === 'holding' || state.type === 'ready_to_drag')
        && state.hold.retainedSelection
    ) {
        const next: PipelineState = {
            type: 'selecting',
            selection: state.hold.retainedSelection,
        };
        return {
            state: next,
            outputs: [
                { type: 'state_changed', state: next },
                { type: 'selection_changed', selection: next.selection.selection },
                { type: 'lifecycle', event: buildIdleLifecycleEvent() },
            ],
        };
    }

    const source = state.type === 'holding' || state.type === 'ready_to_drag'
        ? state.hold.target.selection
        : state.type === 'selecting'
            ? state.selection.selection
            : state.drag.selection;
    const drop = state.type === 'dragging' ? state.drag.drop : null;

    return {
        state: IDLE_PIPELINE_STATE,
        outputs: [
            { type: 'state_changed', state: IDLE_PIPELINE_STATE },
            ...cancelDrop<TPreview>({
                selection: source,
                drop: drop as DragDropSnapshot<TPreview> | null,
                reason,
                pointerType,
            }),
            { type: 'lifecycle', event: buildIdleLifecycleEvent() },
        ],
    };
}

export function clearSelection<TPreview>(state: PipelineState): PipelineExitResult<TPreview> {
    if (state.type !== 'selecting') {
        return { state, outputs: [] };
    }
    return {
        state: IDLE_PIPELINE_STATE,
        outputs: [
            { type: 'selection_changed', selection: null },
            { type: 'state_changed', state: IDLE_PIPELINE_STATE },
            { type: 'lifecycle', event: buildIdleLifecycleEvent() },
        ],
    };
}

export function exitForUnavailableGuard<TPreview>(
    state: PipelineState,
    guardId: GuardId
): PipelineExitResult<TPreview> {
    if (!dependsOnGuard(state, guardId)) {
        return { state, outputs: [] };
    }
    return cancelPipeline(state, 'guard_unavailable', null);
}

export function destroyPipeline<TPreview>(): PipelineExitResult<TPreview> {
    return {
        state: IDLE_PIPELINE_STATE,
        outputs: [
            { type: 'state_changed', state: IDLE_PIPELINE_STATE },
            { type: 'lifecycle', event: buildIdleLifecycleEvent() },
        ],
    };
}
