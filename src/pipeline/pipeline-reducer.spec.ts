import { describe, expect, it } from 'vitest';
import { BlockType } from '../domain/block/block-types';
import type { BlockSelection } from '../domain/selection/block-selection';
import { stringDoc } from '../domain/transaction/string-doc';
import { DragPipeline } from './pipeline-reducer';
import type { DragDropSnapshot } from './pipeline-types';

const selection: BlockSelection = {
    blocks: [{ type: BlockType.ListItem, lines: { startLine: 1, endLine: 1 } }],
};
const drop: DragDropSnapshot = { position: null };
const sourceDoc = stringDoc('- item');

describe('pipeline output decoration', () => {
    it('clears the source highlight when a hold overwrites an active drag', () => {
        const pipeline = new DragPipeline();
        pipeline.enter({ type: 'hold_start', sessionId: 's1', selection });
        pipeline.enter({ type: 'hold_ready', sessionId: 's1' });
        pipeline.enter({ type: 'drag_start', sessionId: 's1', drop, sourceDoc });
        // A new press while dragging moves dragging -> holding; the clear must
        // be emitted even though the pipeline never returns to idle.
        const change = pipeline.enter({ type: 'hold_start', sessionId: 's2', selection });
        expect(change.outputs).toContainEqual({ type: 'drag_source_changed', selection: null, sourceDoc: null });
    });
});
