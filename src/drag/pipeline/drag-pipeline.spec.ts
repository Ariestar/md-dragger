import { describe, expect, it } from 'vitest';
import { createSingleBlockSelection } from '../../domain/selection/block-selection';
import { BlockType } from '../../domain/block/block-types';
import { createDragPipeline } from './drag-pipeline';
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

const secondBlock = {
    ...block,
    startLine: 1,
    endLine: 1,
    content: 'beta',
};

const selection = createSingleBlockSelection(block);
const multiSelection = {
    ...selection,
    ranges: [
        { startLine: 0, endLine: 0 },
        { startLine: 1, endLine: 1 },
    ],
};

describe('drag pipeline object', () => {
    it('can consume outputs as part of enter', () => {
        const observed: string[] = [];
        const pipeline = createDragPipeline({
            onOutputs: (outputs, result) => {
                observed.push(result.current.type);
                observed.push(...outputs.map((output) => output.type));
            },
        });

        const result = pipeline.enter({
            type: 'hold_start',
            sessionId: 's1',
            target: { selection, source: 'handle' },
        });

        expect(result.current.type).toBe('holding');
        expect(observed).toContain('holding');
        expect(observed).toContain('state_changed');
        expect(observed).toContain('lifecycle');
    });

    it('moves a single block selection through the unified drag path', () => {
        const pipeline = createDragPipeline();

        const hold = pipeline.enter({
            type: 'hold_start',
            sessionId: 's1',
            target: { selection, source: 'handle' },
        });
        expect(hold.current.type).toBe('holding');

        expect(pipeline.enter({ type: 'hold_ready', sessionId: 's1' }).current.type).toBe('ready_to_drag');

        const dragging = pipeline.enter({
            type: 'drag_start',
            sessionId: 's1',
            drop: { target: null, rejectReason: 'no_target' },
        });
        expect(dragging.current.type).toBe('dragging');
        if (dragging.current.type === 'dragging') {
            expect(dragging.current.drag.selection.ranges).toEqual([{ startLine: 0, endLine: 0 }]);
        }
        expect(dragging.outputs.some((output) => output.type === 'drag_over')).toBe(true);
        expect(dragging.outputs).toContainEqual({ type: 'drag_source_changed', selection });
    });

    it('uses the same dragging state for multi-range selections', () => {
        const pipeline = createDragPipeline();

        pipeline.enter({
            type: 'hold_start',
            sessionId: 's1',
            target: { selection: multiSelection, source: 'selected_text' },
        });
        pipeline.enter({ type: 'hold_ready', sessionId: 's1' });
        const dragging = pipeline.enter({
            type: 'drag_start',
            sessionId: 's1',
            drop: { target: null, rejectReason: 'no_target' },
        });

        expect(dragging.current.type).toBe('dragging');
        if (dragging.current.type === 'dragging') {
            expect(dragging.current.drag.selection.ranges).toEqual(multiSelection.ranges);
        }
        expect(dragging.outputs).toContainEqual({ type: 'drag_source_changed', selection: multiSelection });
    });

    it('clears drag source visual on terminal drag paths', () => {
        const pipeline = createDragPipeline();

        pipeline.enter({
            type: 'hold_start',
            sessionId: 's1',
            target: { selection, source: 'handle' },
        });
        pipeline.enter({ type: 'hold_ready', sessionId: 's1' });
        pipeline.enter({
            type: 'drag_start',
            sessionId: 's1',
            drop: { target: null, rejectReason: 'no_target' },
        });
        const drop = pipeline.enter({
            type: 'drop',
            sessionId: 's1',
            resolution: { type: 'platform_commit', drop: { target: null } },
        });

        expect(drop.current.type).toBe('idle');
        expect(drop.outputs).toContainEqual({ type: 'drag_source_changed', selection: null });
        expect(drop.outputs).toContainEqual({ type: 'terminal', reason: 'drop' });
    });

    it('keeps selection as a passive pipeline state after finish', () => {
        const pipeline = createDragPipeline();
        pipeline.enter({
            type: 'selection_start',
            seed: { selection },
        });
        const finish = pipeline.enter({ type: 'selection_finish' });

        expect(finish.current).toEqual({
            type: 'selecting',
            selection: {
                selection,
                phase: 'passive',
                guardDeps: [],
            },
        } satisfies PipelineState);
    });

    it('updates selecting state through drag selection policy', () => {
        const pipeline = createDragPipeline();
        pipeline.enter({
            type: 'selection_start',
            seed: {
                selection,
                range: {
                    type: 'range',
                    doc: { lines: 3 },
                    anchorBoundary: {
                        startLineNumber: block.startLine + 1,
                        endLineNumber: block.endLine + 1,
                        representativeLineNumber: block.startLine + 1,
                    },
                    selectedBlocks: [],
                },
            },
        });

        const changed = pipeline.enter({
            type: 'selection_change',
            boundary: {
                startLineNumber: secondBlock.startLine + 1,
                endLineNumber: secondBlock.endLine + 1,
                representativeLineNumber: secondBlock.startLine + 1,
            },
            docLines: 3,
            resolveBoundary: (lineNumber) => ({
                startLineNumber: lineNumber,
                endLineNumber: lineNumber,
            }),
        });

        expect(changed.current.type).toBe('selecting');
        if (changed.current.type !== 'selecting') return;
        expect(changed.current.selection.selection.ranges).toEqual([
            { startLine: 0, endLine: 0 },
            { startLine: 1, endLine: 1 },
        ]);
        expect(changed.outputs.some((output) => output.type === 'selection_changed')).toBe(true);
    });

    it('retains passive selection while held and clears it when dragging starts', () => {
        const pipeline = createDragPipeline();
        pipeline.enter({
            type: 'selection_start',
            seed: { selection: multiSelection },
            guardDeps: ['text-drag-mode'],
        });
        pipeline.enter({ type: 'selection_finish' });

        const hold = pipeline.enter({
            type: 'hold_start',
            sessionId: 's1',
            target: { selection: multiSelection, source: 'selected_text' },
            guardDeps: ['text-drag-mode'],
        });

        expect(hold.current.type).toBe('holding');
        if (hold.current.type === 'holding') {
            expect(hold.current.hold.retainedSelection?.selection).toEqual(multiSelection);
        }
        expect(hold.outputs).not.toContainEqual({ type: 'selection_changed', selection: null });

        pipeline.enter({ type: 'hold_ready', sessionId: 's1' });
        const dragging = pipeline.enter({
            type: 'drag_start',
            sessionId: 's1',
            drop: { target: null, rejectReason: 'no_target' },
        });

        expect(dragging.current.type).toBe('dragging');
        expect(dragging.outputs).toContainEqual({ type: 'selection_changed', selection: null });
        expect(dragging.outputs).toContainEqual({ type: 'drag_source_changed', selection: multiSelection });
    });

    it('clears guard-dependent states when guard becomes unavailable', () => {
        const pipeline = createDragPipeline();
        pipeline.enter({
            type: 'selection_start',
            seed: { selection },
            guardDeps: ['text-drag-mode'],
        });
        pipeline.enter({ type: 'selection_finish' });

        expect(pipeline.enter({ type: 'guard_unavailable', guardId: 'other' }).current.type).toBe('selecting');
        const unavailable = pipeline.enter({ type: 'guard_unavailable', guardId: 'text-drag-mode' });

        expect(unavailable.current.type).toBe('idle');
        expect(unavailable.outputs).toContainEqual({ type: 'selection_changed', selection: null });
        expect(unavailable.outputs).toContainEqual({ type: 'terminal', reason: 'guard_unavailable' });
    });
});
