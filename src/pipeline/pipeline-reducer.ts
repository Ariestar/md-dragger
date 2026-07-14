import type { PipelineEvent } from './pipeline-event';
import type { PipelineOutput } from './pipeline-output';
import type { BlockSelection } from '../domain/selection/block-selection';
import type { LineRange } from '../domain/markdown/line-range-types';
import { createBlockRangeSelectionState, updateBlockRangeSelectionState, type BlockRangeSelectionState } from '../domain/selection/block-range-selection';
import { drop, dragOver, startDragDrop } from './pipeline-drop';
import { clearSelection, cancelPipeline, destroyPipeline, exitForUnavailableGuard } from './pipeline-exit';
import { withGuardDeps } from './pipeline-guard';
import { IDLE_PIPELINE_STATE, type PipelineState } from './pipeline-state';

export type PipelineTransitionResult<TPreview = unknown> = {
    state: PipelineState;
    outputs: PipelineOutput<TPreview>[];
};

export function transitionPipelineState<TPreview>(
    state: PipelineState,
    event: PipelineEvent<TPreview>
): PipelineTransitionResult<TPreview> {
    switch (event.type) {
        case 'hold_start':
            return onHoldStart(state, event);
        case 'hold_ready':
            return onHoldReady(state, event);
        case 'selection_start':
            return onSelectionStart(state, event);
        case 'selection_change':
            return onSelectionChange(state, event);
        case 'selection_clear':
            return clearSelection(state);
        case 'drag_start':
            return onDragStart(state, event);
        case 'drag_over':
            return onDragOver(state, event);
        case 'drop':
            return onDrop(state, event);
        case 'cancel':
            return cancelPipeline(state, event.reason, event.pointerType ?? null);
        case 'guard_unavailable':
            return exitForUnavailableGuard(state, event.guardId);
        case 'destroy':
            return destroyPipeline();
    }
}

function onHoldStart<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'hold_start' }>
): PipelineTransitionResult<TPreview> {
    const next: PipelineState = {
        type: 'holding',
        hold: {
            sessionId: event.sessionId,
            selection: event.selection,
            guardDeps: withGuardDeps(event.guardDeps),
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
        ],
    };
}

function onHoldReady<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'hold_ready' }>
): PipelineTransitionResult<TPreview> {
    if (state.type !== 'holding' || state.hold.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'ready_to_drag',
        hold: state.hold,
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
        ],
    };
}

function onSelectionStart<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'selection_start' }>
): PipelineTransitionResult<TPreview> {
    const rangeState = createSelectionRangeState(event.seed);
    if (event.seed.range && !rangeState) {
        return { state, outputs: [] };
    }
    const selectionRangeState = rangeState ?? undefined;
    const selection = rangeState
        ? buildSelectionFromRangeState(event.seed.selection, rangeState.selectionBlocks)
        : event.seed.selection;
    const next: PipelineState = {
        type: 'selecting',
        selection: {
            selection,
            guardDeps: withGuardDeps(event.guardDeps),
            rangeState: selectionRangeState,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'selection_changed', selection },
        ],
    };
}

function createSelectionRangeState(
    seed: Extract<PipelineEvent, { type: 'selection_start' }>['seed']
): BlockRangeSelectionState | null | undefined {
    if (!seed.range) return undefined;
    return createBlockRangeSelectionState(seed.range);
}

function onSelectionChange<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'selection_change' }>
): PipelineTransitionResult<TPreview> {
    if (state.type !== 'selecting') {
        return { state, outputs: [] };
    }
    if (!state.selection.rangeState || event.docLines === undefined || !event.resolveBoundary) {
        return { state, outputs: [] };
    }

    const rangeState = updateBlockRangeSelectionState(state.selection.rangeState, {
        docLines: event.docLines,
        target: event.boundary,
        resolveBoundary: event.resolveBoundary,
    });
    const selection = buildSelectionFromRangeState(state.selection.selection, rangeState.selectionBlocks);
    const next: PipelineState = {
        type: 'selecting',
        selection: {
            ...state.selection,
            selection,
            rangeState,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'selection_changed', selection },
        ],
    };
}

function buildSelectionFromRangeState(
    base: BlockSelection,
    ranges: LineRange[]
): BlockSelection {
    // Multi-select range state stores line spans; keep primary type from base.
    const primaryType = base.blocks[0]?.type;
    if (!primaryType || ranges.length === 0) {
        return base;
    }
    return {
        blocks: ranges.map((lines) => ({ type: primaryType, lines })),
    };
}

function dragSourceFrom(state: PipelineState): BlockSelection | null {
    switch (state.type) {
        case 'ready_to_drag':
            return state.hold.selection;
        case 'selecting':
            return state.selection.selection;
        default:
            return null;
    }
}

function onDragStart<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drag_start' }>
): PipelineTransitionResult<TPreview> {
    // drag_start may come from a ready_to_drag hold OR from a selecting range
    // that is being upgraded to a drag (long-press range-select → continue
    // holding + drag past threshold). Either way the drag source is the
    // selection held in that state.
    if (state.type !== 'ready_to_drag' && state.type !== 'selecting') {
        return { state, outputs: [] };
    }
    const source = dragSourceFrom(state);
    if (source === null) {
        return { state, outputs: [] };
    }
    const sessionId = state.type === 'ready_to_drag' ? state.hold.sessionId : event.sessionId;
    if (sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    const guardDeps = state.type === 'ready_to_drag'
        ? state.hold.guardDeps
        : state.selection.guardDeps;
    const next: PipelineState = {
        type: 'dragging',
        drag: {
            sessionId: event.sessionId,
            selection: source,
            drop: event.drop,
            guardDeps,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            ...startDragDrop({
                selection: next.drag.selection,
                drop: event.drop,
                pointerType: event.pointerType ?? null,
            }),
        ],
    };
}

function onDragOver<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drag_over' }>
): PipelineTransitionResult<TPreview> {
    if (state.type !== 'dragging' || state.drag.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'dragging',
        drag: {
            ...state.drag,
            drop: event.drop,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            ...dragOver({
                selection: next.drag.selection,
                drop: event.drop,
                pointerType: event.pointerType ?? null,
            }),
        ],
    };
}

function onDrop<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drop' }>
): PipelineTransitionResult<TPreview> {
    if (state.type !== 'dragging' || state.drag.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    return {
        state: IDLE_PIPELINE_STATE,
        outputs: [
            { type: 'state_changed', state: IDLE_PIPELINE_STATE },
            ...drop({
                selection: state.drag.selection,
                resolution: event.resolution,
                pointerType: event.pointerType ?? null,
            }),
        ],
    };
}
