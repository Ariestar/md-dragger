import type { Doc } from '../domain/markdown/document-types';
import type { BlockSelection } from '../domain/selection/block-selection';
import type {
    DragCancelReason,
    DragDropSnapshot,
    DropResolution,
    PipelineEvent,
    PipelineOutput,
    PipelineState,
} from './pipeline-types';
import { IDLE_PIPELINE_STATE } from './pipeline-types';

export type Change = {
    outputs: PipelineOutput[];
};

export type DragPipelineOptions = {
    onChange?: (output: Change) => void;
};

export class DragPipeline {
    private currentState: PipelineState = IDLE_PIPELINE_STATE;

    constructor(private readonly options: DragPipelineOptions = {}) {}

    get state(): PipelineState {
        return this.currentState;
    }

    enter(event: PipelineEvent): Change {
        const previous = this.currentState;
        const transition = transitionPipelineState(previous, event);
        this.currentState = transition.state;
        const output: Change = {
            outputs: this.decorateOutputs(previous, this.currentState, event, transition.outputs),
        };
        this.options.onChange?.(output);
        return output;
    }

    clear(): Change {
        return this.enter({ type: 'destroy' });
    }

    private decorateOutputs(
        previous: PipelineState,
        current: PipelineState,
        event: PipelineEvent,
        outputs: PipelineOutput[],
    ): PipelineOutput[] {
        const decorated = [...outputs];
        if (shouldClearSelectionVisual(previous, current) && !hasSelectionClearOutput(decorated)) {
            decorated.push({ type: 'selection_changed', selection: null });
        }
        if (previous.type !== 'dragging' && current.type === 'dragging') {
            decorated.push({
                type: 'drag_source_changed',
                selection: current.drag.selection,
                sourceDoc: current.drag.sourceDoc,
            });
        }
        // Leaving dragging must re-publish the drag source as cleared,
        // symmetric to the selecting rule — not only on the way back to
        // idle, or an overwrite like dragging → holding would leave the
        // stale source published forever.
        if (previous.type === 'dragging' && current.type !== 'dragging' && current.type !== 'idle') {
            decorated.push({ type: 'drag_source_changed', selection: null, sourceDoc: null });
        }
        if (previous.type !== 'idle' && current.type === 'idle') {
            decorated.push({ type: 'drag_source_changed', selection: null, sourceDoc: null });
        }
        const terminalReason = resolveTerminalReason(previous, current, event);
        if (terminalReason) {
            decorated.push({ type: 'terminal', reason: terminalReason });
        }
        return decorated;
    }
}

function shouldClearSelectionVisual(previous: PipelineState, current: PipelineState): boolean {
    return previous.type === 'selecting' && current.type !== 'selecting';
}

function hasSelectionClearOutput(outputs: PipelineOutput[]): boolean {
    return outputs.some((output) => output.type === 'selection_changed' && output.selection === null);
}

function resolveTerminalReason(
    previous: PipelineState,
    current: PipelineState,
    event: PipelineEvent,
): Extract<PipelineOutput, { type: 'terminal' }>['reason'] | null {
    if (previous.type === 'idle' || current.type !== 'idle') return null;
    switch (event.type) {
        case 'drop':
            return 'drop';
        case 'cancel':
            return 'cancel';
        case 'destroy':
            return 'destroy';
        default:
            return null;
    }
}

type PipelineTransitionResult = {
    state: PipelineState;
    outputs: PipelineOutput[];
};

function transitionPipelineState(state: PipelineState, event: PipelineEvent): PipelineTransitionResult {
    switch (event.type) {
        case 'hold_start':
            return onHoldStart(state, event);
        case 'hold_ready':
            return onHoldReady(state, event);
        case 'selection_set':
            return onSelectionSet(state, event);
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
        case 'destroy':
            return destroyPipeline();
    }
}

function onHoldStart(
    _state: PipelineState,
    event: Extract<PipelineEvent, { type: 'hold_start' }>,
): PipelineTransitionResult {
    const next: PipelineState = {
        type: 'holding',
        hold: {
            sessionId: event.sessionId,
            selection: event.selection,
        },
    };
    return {
        state: next,
        outputs: [{ type: 'state_changed', state: next }],
    };
}

function onHoldReady(
    state: PipelineState,
    event: Extract<PipelineEvent, { type: 'hold_ready' }>,
): PipelineTransitionResult {
    if (state.type !== 'holding' || state.hold.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'ready_to_drag',
        hold: state.hold,
    };
    return {
        state: next,
        outputs: [{ type: 'state_changed', state: next }],
    };
}

function onSelectionSet(
    _state: PipelineState,
    event: Extract<PipelineEvent, { type: 'selection_set' }>,
): PipelineTransitionResult {
    const next: PipelineState = {
        type: 'selecting',
        selection: {
            selection: event.selection,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'selection_changed', selection: event.selection },
        ],
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

function onDragStart(
    state: PipelineState,
    event: Extract<PipelineEvent, { type: 'drag_start' }>,
): PipelineTransitionResult {
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
    const next: PipelineState = {
        type: 'dragging',
        drag: {
            sessionId: event.sessionId,
            selection: source,
            drop: event.drop,
            sourceDoc: event.sourceDoc,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            ...dragOver({
                selection: next.drag.selection,
                drop: event.drop,
                sourceDoc: next.drag.sourceDoc,
                pointerType: event.pointerType ?? null,
            }),
        ],
    };
}

function onDragOver(
    state: PipelineState,
    event: Extract<PipelineEvent, { type: 'drag_over' }>,
): PipelineTransitionResult {
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
                sourceDoc: next.drag.sourceDoc,
                pointerType: event.pointerType ?? null,
            }),
        ],
    };
}

function onDrop(state: PipelineState, event: Extract<PipelineEvent, { type: 'drop' }>): PipelineTransitionResult {
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

function dragOver(params: {
    selection: BlockSelection;
    drop: DragDropSnapshot;
    sourceDoc: Doc;
    pointerType: string | null;
}): PipelineOutput[] {
    return [
        {
            type: 'drag_over',
            selection: params.selection,
            drop: params.drop,
            sourceDoc: params.sourceDoc,
            pointerType: params.pointerType,
        },
    ];
}

function drop(params: {
    selection: BlockSelection;
    resolution: DropResolution;
    pointerType: string | null;
}): PipelineOutput[] {
    if (params.resolution.type === 'cancel') {
        return cancelDrop({
            selection: params.selection,
            reason: params.resolution.reason ?? params.resolution.drop.rejectReason ?? 'no_target',
            pointerType: params.pointerType,
        });
    }

    return [
        {
            type: 'dropped',
            selection: params.selection,
            drop: params.resolution.drop,
            pointerType: params.pointerType,
        },
    ];
}

function cancelDrop(params: {
    selection: BlockSelection | null;
    reason: DragCancelReason;
    pointerType: string | null;
}): PipelineOutput[] {
    return [
        {
            type: 'cancelled',
            selection: params.selection,
            reason: params.reason,
            pointerType: params.pointerType,
        },
    ];
}

function cancelPipeline(
    state: PipelineState,
    reason: DragCancelReason,
    pointerType: string | null,
): PipelineTransitionResult {
    if (state.type === 'idle') {
        return { state, outputs: [] };
    }

    const source =
        state.type === 'holding' || state.type === 'ready_to_drag'
            ? state.hold.selection
            : state.type === 'selecting'
              ? state.selection.selection
              : state.drag.selection;

    return {
        state: IDLE_PIPELINE_STATE,
        outputs: [
            { type: 'state_changed', state: IDLE_PIPELINE_STATE },
            ...cancelDrop({
                selection: source,
                reason,
                pointerType,
            }),
        ],
    };
}

function clearSelection(state: PipelineState): PipelineTransitionResult {
    if (state.type !== 'selecting') {
        return { state, outputs: [] };
    }
    return {
        state: IDLE_PIPELINE_STATE,
        outputs: [
            { type: 'selection_changed', selection: null },
            { type: 'state_changed', state: IDLE_PIPELINE_STATE },
        ],
    };
}

function destroyPipeline(): PipelineTransitionResult {
    return {
        state: IDLE_PIPELINE_STATE,
        outputs: [{ type: 'state_changed', state: IDLE_PIPELINE_STATE }],
    };
}
