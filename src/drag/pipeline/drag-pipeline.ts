import type { PipelineEvent } from './pipeline-event';
import type { PipelineOutput } from './pipeline-output';
import { transitionPipelineState } from './pipeline-reducer';
import { IDLE_PIPELINE_STATE, type PipelineState } from './pipeline-state';

export type PipelineResult<TPreview = unknown> = {
    previous: PipelineState;
    current: PipelineState;
    outputs: PipelineOutput<TPreview>[];
};

export type DragPipelineOptions<TPreview = unknown> = {
    onOutputs?: (outputs: PipelineOutput<TPreview>[], result: PipelineResult<TPreview>) => void;
};

export type DragPipeline<TPreview = unknown> = {
    readonly state: PipelineState;
    enter(event: PipelineEvent<TPreview>): PipelineResult<TPreview>;
    clear(): PipelineResult<TPreview>;
};

export function createDragPipeline<TPreview = unknown>(options?: DragPipelineOptions<TPreview>): DragPipeline<TPreview> {
    return new DragPipelineImpl<TPreview>(options);
}

class DragPipelineImpl<TPreview> implements DragPipeline<TPreview> {
    private currentState: PipelineState = IDLE_PIPELINE_STATE;

    constructor(
        private readonly options: DragPipelineOptions<TPreview> = {}
    ) { }

    get state(): PipelineState {
        return this.currentState;
    }

    enter(event: PipelineEvent<TPreview>): PipelineResult<TPreview> {
        const previous = this.currentState;
        const transition = transitionPipelineState(previous, event);
        this.currentState = transition.state;
        const result = {
            previous,
            current: this.currentState,
            outputs: this.decorateOutputs(previous, this.currentState, event, transition.outputs),
        };
        this.options.onOutputs?.(result.outputs, result);
        return result;
    }

    clear(): PipelineResult<TPreview> {
        return this.enter({ type: 'destroy' });
    }

    private decorateOutputs(
        previous: PipelineState,
        current: PipelineState,
        event: PipelineEvent<TPreview>,
        outputs: PipelineOutput<TPreview>[]
    ): PipelineOutput<TPreview>[] {
        const decorated = [...outputs];
        if (shouldClearSelectionVisual(previous, current) && !hasSelectionClearOutput(decorated)) {
            decorated.push({ type: 'selection_changed', selection: null });
        }
        if (previous.type !== 'dragging' && current.type === 'dragging') {
            decorated.push({ type: 'drag_source_changed', selection: current.drag.selection });
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
    if ((previous.type === 'holding' || previous.type === 'ready_to_drag') && previous.hold.retainedSelection && current.type === 'dragging') {
        return true;
    }
    if (previous.type !== 'selecting' || current.type === 'selecting') {
        return false;
    }
    return !(current.type === 'holding' && current.hold.retainedSelection);
}

function hasSelectionClearOutput(outputs: PipelineOutput[]): boolean {
    return outputs.some((output) => output.type === 'selection_changed' && output.selection === null);
}

function resolveTerminalReason(
    previous: PipelineState,
    current: PipelineState,
    event: PipelineEvent
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
