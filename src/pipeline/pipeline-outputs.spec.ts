import { describe, expect, it } from 'vitest';
import { BlockType } from '../domain/block/block-types';
import type { BlockSelection } from '../domain/selection/block-selection';
import { stringDoc } from '../domain/transaction/string-doc';
import { dragSelectionDoc, dropSeamState } from './pipeline-outputs';
import type { PipelineOutput } from './pipeline-types';

const selection: BlockSelection = {
    blocks: [{ type: BlockType.ListItem, lines: { startLine: 1, endLine: 1 } }],
};

describe('pipeline output contracts', () => {
    it('dropSeamState only reports a seam on the doc that owns the drop', () => {
        const docA = stringDoc('a');
        const docB = stringDoc('b');
        const outputs: PipelineOutput[] = [
            {
                type: 'drag_over',
                selection,
                drop: { position: { doc: docB, line: 1, parent: null } },
                sourceDoc: docA,
                pointerType: 'mouse',
            },
        ];
        expect(dropSeamState(outputs, docB).position).not.toBeNull();
        // A batch whose drop target is another doc must clear this doc's
        // seam — the cross-pane "moved away" case.
        expect(dropSeamState(outputs, docA).position).toBeNull();
    });

    it('dragSelectionDoc follows the drag source across batches', () => {
        const docA = stringDoc('a');
        const outputs: PipelineOutput[] = [
            { type: 'drag_source_changed', selection, sourceDoc: docA },
            {
                type: 'drag_over',
                selection,
                drop: { position: null },
                sourceDoc: docA,
                pointerType: 'mouse',
            },
        ];
        expect(dragSelectionDoc(outputs)).toBe(docA);
    });
});
