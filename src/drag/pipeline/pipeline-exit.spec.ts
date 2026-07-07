import { describe, expect, it } from 'vitest';
import { createSingleBlockSelection } from '../../domain/selection/block-selection';
import { BlockType } from '../../domain/block/block-types';
import { cancelPipeline, exitForUnavailableGuard } from './pipeline-exit';
import type { PipelineState } from './pipeline-state';

const block = {
    type: BlockType.Paragraph,
    startLine: 0,
    endLine: 0,
    from: 0,
    to: 5,
    indentLevel: 0,
    content: 'alpha',
};

const selection = createSingleBlockSelection(block);

describe('pipeline exit rules', () => {
    it('cancels active drag to idle', () => {
        const state: PipelineState = {
            type: 'dragging',
            drag: {
                sessionId: 's1',
                selection,
                drop: { target: null, rejectReason: 'no_target' },
                guardDeps: [],
            },
        };

        const result = cancelPipeline(state, 'pointer_cancelled', 'touch');
        expect(result.state).toEqual({ type: 'idle' });
        expect(result.outputs.some((output) => output.type === 'cancelled')).toBe(true);
    });

    it('only exits states that depend on an unavailable guard', () => {
        const state: PipelineState = {
            type: 'selecting',
            selection: {
                selection,
                phase: 'passive',
                guardDeps: ['text-drag-mode'],
            },
        };

        expect(exitForUnavailableGuard(state, 'other').state).toBe(state);
        expect(exitForUnavailableGuard(state, 'text-drag-mode').state).toEqual({ type: 'idle' });
    });
});
