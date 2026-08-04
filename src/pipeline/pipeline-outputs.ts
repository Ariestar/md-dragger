import type { Doc, DropPosition } from '../domain';
import type { BlockSelection } from '../domain/selection/block-selection';
import type { PipelineOutput } from './pipeline-types';

/**
 * The selected blocks from one engine output batch (null = none).
 * Platform-agnostic consumer of the pipeline output contract, so hosts never
 * re-derive which output types set or clear the selection.
 */
export function selectionFromOutputs(outputs: readonly PipelineOutput[]): BlockSelection | null {
    let selection: BlockSelection | null = null;
    for (const output of outputs) {
        if (output.type === 'selection_changed' || output.type === 'drag_source_changed') {
            selection = output.selection;
        } else if (output.type === 'cancelled' || output.type === 'terminal' || output.type === 'dropped') {
            selection = null;
        }
    }
    return selection;
}

/**
 * The active drop seam from one engine output batch, for the given document:
 * only the view that owns the drop doc paints it; a rejected drop
 * (re-inserting a block in place) still reports invalid so the host can show
 * it as forbidden.
 */
export function dropSeamState(
    outputs: readonly PipelineOutput[],
    doc: Doc,
): { position: DropPosition | null; invalid: boolean } {
    let position: DropPosition | null = null;
    let invalid = false;
    for (const output of outputs) {
        if (output.type === 'drag_over') {
            const onView = output.drop.position && output.drop.position.doc === doc ? output.drop.position : null;
            position = onView;
            invalid = onView !== null && output.drop.rejectReason != null;
        } else if (output.type === 'dropped' || output.type === 'cancelled' || output.type === 'terminal') {
            position = null;
        }
    }
    return { position, invalid };
}
