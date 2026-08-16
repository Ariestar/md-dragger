import { describe, expect, it, vi } from 'vitest';
import { detectBlock } from '../domain/block/block-detector';
import type { BlockSelection } from '../domain/selection/block-selection';
import { selectBlocks, selectOne } from '../domain/selection/block-selection';
import { stringDoc } from '../domain/transaction/string-doc';
import { DraggerRuntime } from './dragger-runtime';
import type { InputSource, MoveInput, PipelineResult, PressInput, ReleaseInput } from './dragger-runtime-types';

function createHarness(
    selectionFromInput?: (input: PressInput, anchor: ReturnType<typeof blockAt>) => BlockSelection | null,
) {
    const doc = stringDoc('alpha\n\nbeta');
    let pressHandler: (input: PressInput) => void = () => undefined;
    let moveHandler: (input: MoveInput) => void = () => undefined;
    let releaseHandler: (input: ReleaseInput) => void = () => undefined;
    const input: InputSource = {
        onPress: (handler) => {
            pressHandler = handler;
            return () => undefined;
        },
        onMove: (handler) => {
            moveHandler = handler;
            return () => undefined;
        },
        onRelease: (handler) => {
            releaseHandler = handler;
            return () => undefined;
        },
    };
    const changes: PipelineResult[] = [];
    const runtime = new DraggerRuntime({
        input,
        document: { getDoc: () => doc },
        locate: {
            sourceLineFromInput: (event) => (event.native as { line: number }).line,
            resolveDropPosition: () => ({ doc, line: doc.lines + 1, parent: null }),
        },
        commit: {},
        config: { tabSize: 4, listIndentUnit: 4 },
        ux: {
            gesture: {
                dragArmMs: 0,
                multiSelectMs: 500,
                dragStartMoveThresholdPx: 4,
                dragCancelMoveThresholdPx: 12,
                multiSelectEnabled: true,
            },
            selectionFromInput,
        },
        onChange: (change) => changes.push(change),
    });
    runtime.mount();
    const pointer = { id: 1, type: 'mouse' };
    return {
        doc,
        changes,
        press(line: number) {
            pressHandler({ point: { x: 0, y: 0 }, pointer, native: { line } });
        },
        move() {
            moveHandler({ point: { x: 5, y: 0 }, pointer });
        },
        release() {
            releaseHandler({ point: { x: 5, y: 0 }, pointer });
        },
        dragSelection(): BlockSelection | null {
            for (const change of [...changes].reverse()) {
                const output = [...change.outputs].reverse().find((item) => item.type === 'drag_source_changed');
                if (output?.type === 'drag_source_changed') return output.selection;
            }
            return null;
        },
    };
}

function blockAt(doc: ReturnType<typeof stringDoc>, line: number) {
    const block = detectBlock(doc, line, { tabSize: 4 });
    if (!block) throw new Error(`No block at line ${line}`);
    return block;
}

describe('DefaultUx host press selection', () => {
    it('uses a host selection with the normal drag threshold', () => {
        let supplied: BlockSelection | null = null;
        const resolver = vi.fn((_input, _anchor) => supplied);
        const harness = createHarness(resolver);
        supplied = selectBlocks([blockAt(harness.doc, 1), blockAt(harness.doc, 3)]);

        harness.press(1);
        harness.move();

        expect(resolver).toHaveBeenCalledWith(
            expect.objectContaining({ native: { line: 1 } }),
            blockAt(harness.doc, 1),
        );
        expect(harness.dragSelection()).toEqual(supplied);
    });

    it('retains single-block behavior when the host returns null', () => {
        const harness = createHarness(() => null);

        harness.press(1);
        harness.move();

        expect(harness.dragSelection()).toEqual(selectOne(blockAt(harness.doc, 1)));
    });
});
