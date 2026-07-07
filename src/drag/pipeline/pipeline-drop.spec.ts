import { describe, expect, it } from 'vitest';
import { createSingleBlockSelection } from '../../domain/selection/block-selection';
import { BlockType } from '../../domain/block/block-types';
import { drop, dragOver, startDragDrop } from './pipeline-drop';

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

describe('pipeline drop phase', () => {
    it('reports drag over without platform preview commands', () => {
        const outputs = dragOver({
            selection,
            drop: { target: null, rejectReason: 'no_target' },
            pointerType: 'mouse',
        });

        expect(outputs.map((output) => output.type)).toEqual(['drag_over', 'lifecycle']);
    });

    it('starts with drag lifecycle then drag over output', () => {
        const outputs = startDragDrop({
            selection,
            drop: { target: null, rejectReason: 'no_target' },
            pointerType: 'mouse',
        });

        expect(outputs.map((output) => output.type)).toEqual(['lifecycle', 'drag_over', 'lifecycle']);
    });

    it('turns command drops into command_ready and dropped outputs', () => {
        const outputs = drop({
            selection,
            pointerType: 'mouse',
            resolution: {
                type: 'command',
                command: {
                    type: 'move',
                    selection,
                    target: {
                        targetLineNumber: 1,
                        placement: 'before',
                    },
                },
                drop: { target: null },
            },
        });

        expect(outputs.map((output) => output.type)).toEqual(['command_ready', 'dropped', 'lifecycle']);
    });
});
