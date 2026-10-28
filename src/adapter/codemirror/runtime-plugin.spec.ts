import { EditorState, type TransactionSpec } from '@codemirror/state';
import type { EditorView, PluginValue } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DropPosition } from '../../domain/command/drop-position';
import { stringDoc } from '../../domain/transaction/string-doc';
import type { Change } from '../../runtime';
import { type MdDraggerCodeMirrorOptions, resolvePerView } from './config';
import { dragRuntime, dragTransitionEffect, resolveDropPositionWithExternalTarget } from './runtime-plugin';
import { viewForDoc } from './views';

describe('CodeMirror host option resolution', () => {
    it('resolves a static value or a per-view factory against the live view', () => {
        const view = {} as EditorView;
        const factory = vi.fn(() => ({ apply: async () => undefined }));

        expect(resolvePerView(factory, view)?.apply).toBeDefined();
        expect(factory).toHaveBeenCalledOnce();
        expect(factory).toHaveBeenCalledWith(view);
        expect(resolvePerView(undefined, view)).toBeUndefined();
        expect(resolvePerView({ selectionFromInput: () => null }, view)).toEqual({
            selectionFromInput: expect.any(Function),
        });
    });
});

describe('resolveDropPositionWithExternalTarget', () => {
    const selection = { blocks: [] };
    const point = { x: 10, y: 20 };
    const defaultPosition: DropPosition = { doc: stringDoc('default'), line: 1, parent: null };
    const externalPosition: DropPosition = { doc: stringDoc('external'), line: 2, parent: null };

    it('falls through to normal CodeMirror resolution only on undefined', () => {
        const fallback = vi.fn(() => defaultPosition);

        expect(resolveDropPositionWithExternalTarget(() => undefined, fallback, point, { selection })).toBe(
            defaultPosition,
        );
        expect(fallback).toHaveBeenCalledOnce();
    });

    it('treats null as a handled invalid external target', () => {
        const fallback = vi.fn(() => defaultPosition);

        expect(resolveDropPositionWithExternalTarget(() => null, fallback, point, { selection })).toBeNull();
        expect(fallback).not.toHaveBeenCalled();
    });

    it('accepts a position whose document has no registered editor view', () => {
        const fallback = vi.fn(() => defaultPosition);

        expect(resolveDropPositionWithExternalTarget(() => externalPosition, fallback, point, { selection })).toBe(
            externalPosition,
        );
        expect(fallback).not.toHaveBeenCalled();
    });
});

// CodeMirror destroys view plugins inside an update when it resets or
// reconfigures a view (EditorView.setState, a reconfigure that drops the
// plugin), and rejects any dispatch to that view until the update ends.
const NESTED_UPDATE = 'Calls to EditorView.update are not allowed while an update is in progress';

type FakeView = EditorView & { updating: boolean; changes: Change[] };

/** An EditorView stand-in (there is no DOM here) that rejects a dispatch while it updates. */
function fakeView(text: string): FakeView {
    const win = Object.assign(new EventTarget(), { screenX: 0, screenY: 0, innerWidth: 800, innerHeight: 600 });
    const document = Object.assign(new EventTarget(), { defaultView: win });
    Object.assign(win, { document });
    const view = {
        dom: Object.assign(new EventTarget(), { ownerDocument: document }),
        state: EditorState.create({ doc: text }),
        updating: false,
        changes: [] as Change[],
        dispatch(spec: TransactionSpec) {
            if (view.updating) throw new Error(NESTED_UPDATE);
            for (const effect of [spec.effects ?? []].flat()) {
                if (effect.is(dragTransitionEffect)) view.changes.push(effect.value);
            }
        },
    };
    return view as unknown as FakeView;
}

const options: MdDraggerCodeMirrorOptions = {
    config: { tabSize: 4, listIndentUnit: 4 },
    listIndentWidthPx: 16,
    locate: { sourceLineFromInput: () => 1, lineFromPoint: () => 1 },
    externalTarget: { resolveDropPosition: () => null },
};

const mounted: { view: FakeView; plugin: PluginValue }[] = [];

/** Builds the plugin the way CodeMirror does, through its internal `create`. */
function mount(view: FakeView, host: MdDraggerCodeMirrorOptions = options): PluginValue {
    const plugin = (dragRuntime(host) as unknown as { create(view: EditorView): PluginValue }).create(view);
    mounted.push({ view, plugin });
    return plugin;
}

function pointer(type: string, x: number, y: number): Event {
    return Object.assign(new Event(type), {
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: 'mouse',
        button: 0,
        buttons: 1,
    });
}

function startDrag(view: FakeView): void {
    const win = view.dom.ownerDocument.defaultView as unknown as EventTarget;
    view.dom.dispatchEvent(pointer('pointerdown', 0, 0));
    win.dispatchEvent(pointer('pointermove', 0, 0));
    win.dispatchEvent(pointer('pointermove', 12, 12));
}

const outputTypes = (changes: Change[]) => changes.flatMap((change) => change.outputs.map((output) => output.type));

describe('dragRuntime teardown', () => {
    afterEach(() => {
        // Newest first: a re-mounted view is registered by its latest plugin.
        for (const { view, plugin } of mounted.splice(0).reverse()) {
            view.updating = false;
            if (viewForDoc(view.state.doc)) plugin.destroy?.();
        }
    });

    it('does not dispatch to a view whose plugin CodeMirror removes mid-update, and stops broadcasting to it', () => {
        const removed = fakeView('- a\n- b');
        const source = fakeView('- c\n- d');
        const plugin = mount(removed);
        mount(source);

        removed.updating = true;
        expect(() => plugin.destroy?.()).not.toThrow();
        removed.updating = false;
        startDrag(source);

        expect(outputTypes(source.changes)).toContain('drag_source_changed');
        expect(removed.changes).toEqual([]);
    });

    it('delivers each batch once to a view that is reset while receiving it', () => {
        const reset = fakeView('- a\n- b');
        const source = fakeView('- c\n- d');
        let plugin = mount(reset);
        mount(source);
        // A host resets the view on the first batch: setState replaces its
        // plugin inside an update, so the view leaves and rejoins the live
        // views mid-broadcast.
        const receive = reset.dispatch.bind(reset);
        reset.dispatch = (spec: TransactionSpec) => {
            receive(spec);
            if (reset.changes.length === 1) {
                reset.updating = true;
                plugin.destroy?.();
                plugin = mount(reset);
                reset.updating = false;
            }
        };

        startDrag(source);

        expect(reset.changes.length).toBeGreaterThan(0);
        expect(new Set(reset.changes).size).toBe(reset.changes.length);
    });

    it('clears a drag in the other views when the source view is reset mid-drag', () => {
        const source = fakeView('- a\n- b');
        const other = fakeView('- c\n- d');
        const plugin = mount(source);
        mount(other);
        startDrag(source);
        expect(outputTypes(other.changes)).toContain('drag_source_changed');
        source.changes = [];
        other.changes = [];

        source.updating = true;
        expect(() => plugin.destroy?.()).not.toThrow();

        expect(source.changes).toEqual([]);
        expect(other.changes.at(-1)?.outputs).toContainEqual({ type: 'terminal', reason: 'destroy' });
    });

    it('stops broadcasting to a view whose teardown threw', () => {
        const failed = fakeView('- a\n- b');
        const source = fakeView('- c\n- d');
        const plugin = mount(failed, {
            ...options,
            onChange: () => {
                throw new Error('host onChange failed');
            },
        });
        mount(source);

        expect(() => plugin.destroy?.()).toThrow('host onChange failed');
        failed.changes = [];
        startDrag(source);

        expect(outputTypes(source.changes)).toContain('drag_source_changed');
        expect(failed.changes).toEqual([]);
    });
});
