import { describe, expect, it, vi } from 'vitest';
import { detectBlock } from '../domain/block/block-detector';
import { selectOne } from '../domain/selection/block-selection';
import { stringDoc } from '../domain/transaction/string-doc';
import type { PipelineOutput } from '../pipeline/pipeline-types';
import { DraggerRuntime } from './dragger-runtime';
import type { CommitHost, Point, Pointer } from './dragger-runtime-types';

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createRuntime(commit: CommitHost) {
    const sourceDoc = stringDoc('source\n\nkeep');
    const targetDoc = stringDoc('target');
    const block = detectBlock(sourceDoc, 1, { tabSize: 4 });
    if (!block) throw new Error('Missing source block');
    const outputs: PipelineOutput[] = [];
    const runtime = new DraggerRuntime({
        input: {
            onPress: () => () => undefined,
            onMove: () => () => undefined,
            onRelease: () => () => undefined,
        },
        document: { getDoc: () => sourceDoc },
        locate: {
            sourceLineFromInput: () => 1,
            resolveDropPosition: () => ({ doc: targetDoc, line: targetDoc.lines + 1, parent: null }),
        },
        commit,
        config: { tabSize: 4, listIndentUnit: 4 },
        onChange: (change) => outputs.push(...change.outputs),
    });
    const point: Point = { x: 0, y: 0 };
    const pointer: Pointer = { id: 1, type: 'mouse' };
    const sessionId = 'test-session';
    runtime.beginHold(sessionId, selectOne(block), pointer.type);
    runtime.markHoldReady(sessionId, pointer.type);
    runtime.beginDrag(sessionId, selectOne(block), point, pointer, pointer.type);
    return {
        outputs,
        commit: () => runtime.commitDrop(sessionId, point, pointer, pointer.type),
        commitWithAlt: () => runtime.commitDrop(sessionId, point, pointer, pointer.type, { altKey: true }),
        cancel: () => runtime.cancel('pointer_cancelled', pointer.type),
    };
}

describe('DraggerRuntime host commit', () => {
    it('publishes dropped only after an asynchronous host commit resolves', async () => {
        const gate = deferred<void>();
        const apply = vi.fn(() => gate.promise);
        const harness = createRuntime({ apply });

        const result = harness.commit();

        expect(apply).toHaveBeenCalledOnce();
        expect(apply.mock.calls[0]?.[0]).toHaveLength(2);
        expect(harness.outputs.map((output) => output.type)).not.toContain('dropped');

        gate.resolve();
        await expect(result).resolves.toMatchObject({ kind: 'applied' });
        expect(harness.outputs.map((output) => output.type)).toContain('dropped');
    });

    it('rejects without dropped output when an asynchronous host commit fails', async () => {
        const gate = deferred<void>();
        const harness = createRuntime({ apply: () => gate.promise });

        const result = harness.commit();
        gate.reject(new Error('write failed'));

        await expect(result).resolves.toEqual({ kind: 'rejected' });
        expect(harness.outputs.map((output) => output.type)).not.toContain('dropped');
        expect(harness.outputs).toContainEqual(expect.objectContaining({ type: 'cancelled', reason: 'commit_failed' }));
    });

    it('does not cancel an in-flight host commit after release', async () => {
        const gate = deferred<void>();
        const harness = createRuntime({ apply: () => gate.promise });

        const result = harness.commit();
        harness.cancel();
        gate.resolve();

        await expect(result).resolves.toMatchObject({ kind: 'applied' });
        expect(harness.outputs.map((output) => output.type)).toContain('dropped');
    });

    it('does not apply the same drop twice while an asynchronous host commit is pending', async () => {
        const gate = deferred<void>();
        const apply = vi.fn(() => gate.promise);
        const harness = createRuntime({ apply });

        const first = harness.commit();
        const second = harness.commit();

        expect(second).toBeUndefined();
        expect(apply).toHaveBeenCalledOnce();

        gate.resolve();
        await expect(first).resolves.toMatchObject({ kind: 'applied' });
    });

    it('executes a copy when alt modifier is held on commit', () => {
        const apply = vi.fn();
        const harness = createRuntime({ apply });

        harness.commitWithAlt();

        expect(apply).toHaveBeenCalledOnce();
        // Across docs, copy only edits the target doc (1 edit instead of 2).
        expect(apply.mock.calls[0]?.[0]).toHaveLength(1);
    });
});

describe('DraggerRuntime drop indicator', () => {
    it('paints the line the write uses, for a move and for a copy', () => {
        // The pointer is on the upper half of `P`; `- s` joins the list above, loose once it moves, tight when copied.
        const doc = stringDoc('- a\n\n- s\n- b\n\n\nP');
        const block = detectBlock(doc, 3, { tabSize: 4 });
        if (!block) throw new Error('Missing source block');
        const outputs: PipelineOutput[] = [];
        const runtime = new DraggerRuntime({
            input: {
                onPress: () => () => undefined,
                onMove: () => () => undefined,
                onRelease: () => () => undefined,
            },
            document: { getDoc: () => doc },
            locate: {
                sourceLineFromInput: () => 3,
                resolveDropPosition: () => ({ doc, line: 7, parent: null }),
            },
            commit: { apply: () => undefined },
            config: { tabSize: 4, listIndentUnit: 4 },
            onChange: (change) => outputs.push(...change.outputs),
        });
        const point: Point = { x: 0, y: 0 };
        const pointer: Pointer = { id: 1, type: 'mouse' };
        const painted = () => {
            const over = outputs.filter((output) => output.type === 'drag_over').at(-1);
            return over?.type === 'drag_over' ? over.drop.position?.line : undefined;
        };
        runtime.beginHold('seam', selectOne(block), pointer.type);
        runtime.markHoldReady('seam', pointer.type);
        runtime.beginDrag('seam', selectOne(block), point, pointer, pointer.type);
        runtime.moveDrag('seam', point, pointer, pointer.type);
        expect(painted()).toBe(6);
        runtime.moveDrag('seam', point, pointer, pointer.type, { altKey: true });
        expect(painted()).toBe(5);
    });
});
