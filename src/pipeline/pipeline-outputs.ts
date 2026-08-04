import type { Doc, DropPosition } from '../domain';
import type { BlockSelection } from '../domain/selection/block-selection';
import type { PipelineOutput } from './pipeline-types';
/**
 * The selected blocks from one engine output batch (null = none).
 * Platform-agnostic consumer of the pipeline output contract, so hosts never
 * re-derive which output types set or clear the selection. drag_over also
 * carries the drag source: during a drag every move batch is drag_over-only,
 * and the selection must survive it.
 */
export function selectionFromOutputs(outputs: readonly PipelineOutput[]): BlockSelection | null {
    let selection: BlockSelection | null = null;
    for (const output of outputs) {
        if (
            output.type === 'selection_changed' ||
            output.type === 'drag_source_changed' ||
            output.type === 'drag_over'
        ) {
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

/**
 * The doc that owns the current drag selection (drag_source_changed /
 * drag_over carry it). Painters skip a batch whose doc is not their own —
 * a cross-pane broadcast reaches the target view for the seam, but the
 * source highlight must stay on the view that owns the drag.
 */
export function dragSelectionDoc(outputs: readonly PipelineOutput[]): Doc | null {
    let doc: Doc | null = null;
    for (const output of outputs) {
        if (output.type === 'drag_source_changed') {
            doc = output.sourceDoc;
        } else if (output.type === 'drag_over') {
            doc = output.sourceDoc;
        } else if (output.type === 'cancelled' || output.type === 'terminal' || output.type === 'dropped') {
            doc = null;
        }
    }
    return doc;
}
