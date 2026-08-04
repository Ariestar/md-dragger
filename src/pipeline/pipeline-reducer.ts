import type { BlockSelection } from '../domain/selection/block-selection';
import type {
    DragCancelReason,
    DragDropSnapshot,
    DropResolution,
    GuardId,
    PipelineEvent,
    PipelineOutput,
    PipelineState,
} from './pipeline-types';
import { IDLE_PIPELINE_STATE } from './pipeline-types';

export type Change<TPreview = unknown> = {
    previous: PipelineState;
    current: PipelineState;
    outputs: PipelineOutput<TPreview>[];
    event: PipelineEvent<TPreview>;
};

export type DragPipelineOptions<TPreview = unknown> = {
    onChange?: (output: Change<TPreview>) => void;
};

export class DragPipeline<TPreview = unknown> {
    private currentState: PipelineState = IDLE_PIPELINE_STATE;

    constructor(private readonly options: DragPipelineOptions<TPreview> = {}) {}

    get state(): PipelineState {
        return this.currentState;
    }

    enter(event: PipelineEvent<TPreview>): Change<TPreview> {
        const previous = this.currentState;
        const transition = transitionPipelineState(previous, event);
        this.currentState = transition.state;
        const output: Change<TPreview> = {
            previous,
            current: this.currentState,
            outputs: this.decorateOutputs(previous, this.currentState, event, transition.outputs),
            event,
        };
        this.options.onChange?.(output);
        return output;
    }

    clear(): Change<TPreview> {
        return this.enter({ type: 'destroy' });
    }

    private decorateOutputs(
        previous: PipelineState,
        current: PipelineState,
        event: PipelineEvent<TPreview>,
        outputs: PipelineOutput<TPreview>[],
    ): PipelineOutput<TPreview>[] {
        const decorated = [...outputs];
        if (shouldClearSelectionVisual(previous, current) && !hasSelectionClearOutput(decorated)) {
            decorated.push({ type: 'selection_changed', selection: null });
        }
        if (previous.type !== 'dragging' && current.type === 'dragging') {
            decorated.push({ type: 'drag_source_changed', selection: current.drag.selection });
        }
        // Leaving dragging must re-publish the drag source as cleared,
        // symmetric to the selecting rule — not only on the way back to
        // idle, or an overwrite like dragging → holding would leave the
        // stale source published forever.
        if (previous.type === 'dragging' && current.type !== 'dragging' && current.type !== 'idle') {
            decorated.push({ type: 'drag_source_changed', selection: null });
        }
        if (previous.type !== 'idle' && current.type === 'idle') {
            decorated.push({ type: 'drag_source_changed', selection: null });
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
        case 'guard_unavailable':
            return 'guard_unavailable';
        default:
            return null;
    }
}

export type PipelineTransitionResult<TPreview = unknown> = {
    state: PipelineState;
    outputs: PipelineOutput<TPreview>[];
};

export function transitionPipelineState<TPreview>(
    state: PipelineState,
    event: PipelineEvent<TPreview>,
): PipelineTransitionResult<TPreview> {
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
        case 'guard_unavailable':
            return exitForUnavailableGuard(state, event.guardId);
        case 'destroy':
            return destroyPipeline();
    }
}

function onHoldStart<TPreview>(
    _state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'hold_start' }>,
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
        outputs: [{ type: 'state_changed', state: next }],
    };
}

function onHoldReady<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'hold_ready' }>,
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
        outputs: [{ type: 'state_changed', state: next }],
    };
}

function onSelectionSet<TPreview>(
    _state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'selection_set' }>,
): PipelineTransitionResult<TPreview> {
    const next: PipelineState = {
        type: 'selecting',
        selection: {
            selection: event.selection,
            guardDeps: withGuardDeps(event.guardDeps),
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

function onDragStart<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drag_start' }>,
): PipelineTransitionResult<TPreview> {
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
    const guardDeps = state.type === 'ready_to_drag' ? state.hold.guardDeps : state.selection.guardDeps;
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
            ...dragOver({
                selection: next.drag.selection,
                drop: event.drop,
                pointerType: event.pointerType ?? null,
            }),
        ],
    };
}

function onDragOver<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drag_over' }>,
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
    event: Extract<PipelineEvent<TPreview>, { type: 'drop' }>,
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

function dragOver<TPreview>(params: {
    selection: BlockSelection;
    drop: DragDropSnapshot<TPreview>;
    pointerType: string | null;
}): PipelineOutput<TPreview>[] {
    return [
        {
            type: 'drag_over',
            selection: params.selection,
            drop: params.drop,
            pointerType: params.pointerType,
        },
    ];
}

function drop<TPreview>(params: {
    selection: BlockSelection;
    resolution: DropResolution<TPreview>;
    pointerType: string | null;
}): PipelineOutput<TPreview>[] {
    if (params.resolution.type === 'cancel') {
        return cancelDrop<TPreview>({
            selection: params.selection,
            reason: params.resolution.reason ?? params.resolution.drop.rejectReason ?? 'no_target',
            pointerType: params.pointerType,
        });
    }

    const outputs: PipelineOutput<TPreview>[] = [];
    if (params.resolution.type === 'command') {
        outputs.push({ type: 'command_ready', command: params.resolution.command });
    }
    outputs.push({
        type: 'dropped',
        selection: params.selection,
        drop: params.resolution.drop,
        pointerType: params.pointerType,
    });
    return outputs;
}

function cancelDrop<TPreview>(params: {
    selection: BlockSelection | null;
    reason: DragCancelReason;
    pointerType: string | null;
}): PipelineOutput<TPreview>[] {
    return [
        {
            type: 'cancelled',
            selection: params.selection,
            reason: params.reason,
            pointerType: params.pointerType,
        },
    ];
}

function cancelPipeline<TPreview>(
    state: PipelineState,
    reason: DragCancelReason,
    pointerType: string | null,
): PipelineTransitionResult<TPreview> {
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
            ...cancelDrop<TPreview>({
                selection: source,
                reason,
                pointerType,
            }),
        ],
    };
}

function clearSelection<TPreview>(state: PipelineState): PipelineTransitionResult<TPreview> {
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

function exitForUnavailableGuard<TPreview>(state: PipelineState, guardId: GuardId): PipelineTransitionResult<TPreview> {
    if (!dependsOnGuard(state, guardId)) {
        return { state, outputs: [] };
    }
    return cancelPipeline(state, 'guard_unavailable', null);
}

function destroyPipeline<TPreview>(): PipelineTransitionResult<TPreview> {
    return {
        state: IDLE_PIPELINE_STATE,
        outputs: [{ type: 'state_changed', state: IDLE_PIPELINE_STATE }],
    };
}

function dependsOnGuard(state: PipelineState, guardId: GuardId): boolean {
    switch (state.type) {
        case 'holding':
        case 'ready_to_drag':
            return state.hold.guardDeps.includes(guardId);
        case 'selecting':
            return state.selection.guardDeps.includes(guardId);
        case 'dragging':
            return state.drag.guardDeps.includes(guardId);
        default:
            return false;
    }
}

function withGuardDeps(guardDeps?: GuardId[]): GuardId[] {
    return [...new Set(guardDeps ?? [])];
}
