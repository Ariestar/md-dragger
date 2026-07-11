// @vitest-environment node
import { EditorState } from '@codemirror/state';
import { describe, expect, it, vi } from 'vitest';
import { DraggerRuntime } from './dragger-runtime';
import type {
    InputSource,
    MoveInput,
    PipelineResult,
    PressInput,
    Pointer,
    ReleaseInput,
} from './dragger-runtime-types';

function makeDoc() {
    return EditorState.create({ doc: '- alpha\n- beta\n- gamma\n- delta' }).doc;
}

function mockInput() {
    let pressH: ((i: PressInput) => void) | null = null;
    let moveH: ((i: MoveInput) => void) | null = null;
    let releaseH: ((i: ReleaseInput) => void) | null = null;
    const source: InputSource = {
        onPress: (h) => { pressH = h; return () => { pressH = null; }; },
        onMove: (h) => { moveH = h; return () => { moveH = null; }; },
        onRelease: (h) => { releaseH = h; return () => { releaseH = null; }; },
    };
    return {
        source,
        press: (i: PressInput) => pressH?.(i),
        move: (i: MoveInput) => moveH?.(i),
        release: (i: ReleaseInput) => releaseH?.(i),
    };
}

const pointer: Pointer = { id: 1, type: 'mouse' };

function pressAt(releaseCapture = () => {}): PressInput {
    return {
        point: { x: 10, y: 20 },
        pointer,
        button: 0,
        modifiers: {},
        native: {},
        claim: () => {},
        capture: () => {},
        releaseCapture,
    };
}

describe('DraggerRuntime pipeline result + commit', () => {
    it('forwards the full pipeline result through onChange (no second event system)', () => {
        const doc = makeDoc();
        const input = mockInput();
        const results: PipelineResult[] = [];
        const dropTarget = { targetDoc: doc, targetLineNumber: 4, placement: 'before' as const };

        const rt = new DraggerRuntime({
            input: input.source,
            document: { getDoc: () => doc },
            locate: {
                sourceLineFromInput: () => 1,
                lineFromPoint: () => 1,
                resolveDropTarget: () => dropTarget,
            },
            commit: { apply: () => {} },
            onChange: (result) => { results.push(result); },
            gestureConfig: {
                dragArmMs: 0,
                multiSelectMs: 500,
                dragStartMoveThresholdPx: 4,
                dragCancelMoveThresholdPx: 12,
                multiSelectEnabled: false,
            },
        });
        rt.mount();

        input.press(pressAt());
        input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
        input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });

        // Every transition carries previous/current/outputs/event.
        expect(results.length).toBeGreaterThan(0);
        for (const result of results) {
            expect(result).toEqual(expect.objectContaining({
                previous: expect.anything(),
                current: expect.anything(),
                outputs: expect.any(Array),
                event: expect.anything(),
            }));
        }
        const types = results.flatMap((r) => r.outputs.map((o) => o.type));
        expect(types).toContain('dropped');
        expect(types).toContain('terminal');

        rt.destroy();
    });

    it('apply mode (default): plans, emits platform_commit path, applies edits', () => {
        const doc = makeDoc();
        const input = mockInput();
        const applies: unknown[] = [];
        const results: PipelineResult[] = [];
        const dropTarget = { targetDoc: doc, targetLineNumber: 4, placement: 'before' as const };

        const rt = new DraggerRuntime({
            input: input.source,
            document: { getDoc: () => doc },
            locate: {
                sourceLineFromInput: () => 1,
                lineFromPoint: () => 1,
                resolveDropTarget: () => dropTarget,
            },
            commit: {
                apply: (edits) => { applies.push(edits); },
            },
            onChange: (result) => { results.push(result); },
            gestureConfig: {
                dragArmMs: 0,
                multiSelectMs: 500,
                dragStartMoveThresholdPx: 4,
                dragCancelMoveThresholdPx: 12,
                multiSelectEnabled: false,
            },
        });
        rt.mount();

        input.press(pressAt());
        input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
        input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });

        expect(applies.length).toBe(1);
        const types = results.flatMap((r) => r.outputs.map((o) => o.type));
        expect(types).toContain('dropped');
        expect(types).not.toContain('command_ready');

        rt.destroy();
    });

    it('command mode: emits command_ready, does not call apply', () => {
        const doc = makeDoc();
        const input = mockInput();
        const apply = vi.fn();
        const results: PipelineResult[] = [];
        const dropTarget = { targetDoc: doc, targetLineNumber: 4, placement: 'before' as const };

        const rt = new DraggerRuntime({
            input: input.source,
            document: { getDoc: () => doc },
            locate: {
                sourceLineFromInput: () => 1,
                lineFromPoint: () => 1,
                resolveDropTarget: () => dropTarget,
            },
            commit: {
                mode: 'command',
                apply,
            },
            onChange: (result) => { results.push(result); },
            gestureConfig: {
                dragArmMs: 0,
                multiSelectMs: 500,
                dragStartMoveThresholdPx: 4,
                dragCancelMoveThresholdPx: 12,
                multiSelectEnabled: false,
            },
        });
        rt.mount();

        input.press(pressAt());
        input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
        input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });

        expect(apply).not.toHaveBeenCalled();
        const types = results.flatMap((r) => r.outputs.map((o) => o.type));
        expect(types).toContain('command_ready');
        expect(types).toContain('dropped');
        const command = results
            .flatMap((r) => r.outputs)
            .find((o) => o.type === 'command_ready');
        expect(command).toEqual(expect.objectContaining({
            type: 'command_ready',
            command: expect.objectContaining({ type: 'move' }),
        }));

        rt.destroy();
    });

    it('releases pointer capture on successful drop, cancel, and destroy', () => {
        const doc = makeDoc();
        const dropTarget = { targetDoc: doc, targetLineNumber: 4, placement: 'before' as const };

        // success path
        {
            const input = mockInput();
            const releaseCapture = vi.fn();
            const rt = new DraggerRuntime({
                input: input.source,
                document: { getDoc: () => doc },
                locate: {
                    sourceLineFromInput: () => 1,
                    lineFromPoint: () => 1,
                    resolveDropTarget: () => dropTarget,
                },
                commit: { apply: () => {} },
                gestureConfig: {
                    dragArmMs: 0, multiSelectMs: 0,
                    dragStartMoveThresholdPx: 4,
                    dragCancelMoveThresholdPx: 12,
                    multiSelectEnabled: false,
                },
            });
            rt.mount();
            input.press(pressAt(releaseCapture));
            input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
            input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });
            expect(releaseCapture).toHaveBeenCalled();
            rt.destroy();
        }

        // cancel path
        {
            const input = mockInput();
            const releaseCapture = vi.fn();
            const rt = new DraggerRuntime({
                input: input.source,
                document: { getDoc: () => doc },
                locate: {
                    sourceLineFromInput: () => 1,
                    lineFromPoint: () => 1,
                    resolveDropTarget: () => dropTarget,
                },
                commit: { apply: () => {} },
                gestureConfig: {
                    dragArmMs: 0, multiSelectMs: 0,
                    dragStartMoveThresholdPx: 4,
                    dragCancelMoveThresholdPx: 12,
                    multiSelectEnabled: false,
                },
            });
            rt.mount();
            input.press(pressAt(releaseCapture));
            input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
            expect(rt.state.type).toBe('dragging');
            rt.cancel('pointer_cancelled', 'mouse');
            expect(releaseCapture).toHaveBeenCalled();
            rt.destroy();
        }

        // destroy while dragging
        {
            const input = mockInput();
            const releaseCapture = vi.fn();
            const rt = new DraggerRuntime({
                input: input.source,
                document: { getDoc: () => doc },
                locate: {
                    sourceLineFromInput: () => 1,
                    lineFromPoint: () => 1,
                    resolveDropTarget: () => dropTarget,
                },
                commit: { apply: () => {} },
                gestureConfig: {
                    dragArmMs: 0, multiSelectMs: 0,
                    dragStartMoveThresholdPx: 4,
                    dragCancelMoveThresholdPx: 12,
                    multiSelectEnabled: false,
                },
            });
            rt.mount();
            input.press(pressAt(releaseCapture));
            input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
            expect(rt.state.type).toBe('dragging');
            rt.destroy();
            expect(releaseCapture).toHaveBeenCalled();
        }
    });
});
