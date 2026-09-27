import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { nativePointerEvent, pointerInput } from './pointer-input';
import { registerView, viewAtPoint } from './views';

// Hosts can move an editor into another document after building it: Obsidian
// builds a canvas card's editor in the main window, then moves it into the
// card's iframe. Plain EventTargets stand in for the windows here.

type FakeDocument = EventTarget & { visibilityState: string; defaultView: FakeWindow };
type FakeWindow = EventTarget & { document: FakeDocument };

function fakeWindow(): FakeWindow {
    const win = new EventTarget() as FakeWindow;
    win.document = Object.assign(new EventTarget(), { visibilityState: 'visible', defaultView: win });
    return win;
}

function editorIn(win: FakeWindow) {
    const dom = Object.assign(new EventTarget(), { ownerDocument: win.document });
    return {
        view: { dom } as unknown as EditorView,
        moveTo: (next: FakeWindow) => {
            dom.ownerDocument = next.document;
        },
    };
}

/** A pointer event as another window would create it: not an instance of this realm's PointerEvent. */
function pointer(type: string): Event {
    return Object.assign(new Event(type), { clientX: 5, clientY: 6, pointerId: 1, pointerType: 'mouse', button: 0 });
}

describe('adapter/codemirror pointerInput across windows', () => {
    it('moves its window listeners to the window that owns the editor when it is pressed', () => {
        const main = fakeWindow();
        const frame = fakeWindow();
        const { view, moveTo } = editorIn(main);
        const input = pointerInput(view);
        const seen: string[] = [];
        input.onPress(() => seen.push('press'));
        input.onMove(() => seen.push('move'));
        input.onRelease(() => seen.push('release'));
        input.onEscape(() => {
            seen.push('escape');
            return false;
        });

        moveTo(frame);
        view.dom.dispatchEvent(pointer('pointerdown'));
        main.dispatchEvent(pointer('pointermove'));
        frame.dispatchEvent(pointer('pointermove'));
        frame.dispatchEvent(pointer('pointerup'));
        frame.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));

        expect(seen).toEqual(['press', 'move', 'release', 'escape']);
    });

    it("cancels on the owning window's blur and its document's visibility change", () => {
        const frame = fakeWindow();
        const { view, moveTo } = editorIn(fakeWindow());
        const input = pointerInput(view);
        let cancels = 0;
        input.onPress(() => {});
        input.onCancel(() => {
            cancels++;
        });

        moveTo(frame);
        view.dom.dispatchEvent(pointer('pointerdown'));
        frame.dispatchEvent(new Event('blur'));
        frame.document.visibilityState = 'hidden';
        frame.document.dispatchEvent(new Event('visibilitychange'));

        expect(cancels).toBe(2);
    });

    it('stops listening on the window it is bound to when unsubscribed', () => {
        const frame = fakeWindow();
        const { view, moveTo } = editorIn(fakeWindow());
        const input = pointerInput(view);
        let moves = 0;
        input.onPress(() => {});
        const off = input.onMove(() => {
            moves++;
        });
        moveTo(frame);
        view.dom.dispatchEvent(pointer('pointerdown'));

        off();
        frame.dispatchEvent(pointer('pointermove'));

        expect(moves).toBe(0);
    });

    it("accepts pointer events from another window's realm", () => {
        const event = pointer('pointerdown');
        expect(nativePointerEvent(event)).toBe(event);
        expect(nativePointerEvent(new Event('pointerdown'))).toBeNull();
    });
});

describe('adapter/codemirror viewAtPoint', () => {
    let unregister: (() => void)[] = [];
    afterEach(() => {
        for (const off of unregister) off();
        unregister = [];
    });

    // Two editors in different documents can cover the same coordinates: a
    // card's iframe-local point also names a spot in the main window.
    function editorAt(doc: Document): EditorView {
        const view = {
            dom: {
                ownerDocument: doc,
                contains: () => false,
                getBoundingClientRect: () => ({ left: 0, top: 0, right: 100, bottom: 100 }),
            },
        } as unknown as EditorView;
        unregister.push(registerView(view));
        return view;
    }

    it('only considers editors in the given document', () => {
        const main = { elementFromPoint: () => null } as unknown as Document;
        const frame = { elementFromPoint: () => null } as unknown as Document;
        const inMain = editorAt(main);
        const inFrame = editorAt(frame);

        expect(viewAtPoint(10, 10, frame)).toBe(inFrame);
        expect(viewAtPoint(10, 10, main)).toBe(inMain);
    });

    it('hit-tests in the given document', () => {
        const hit = {};
        const frame = { elementFromPoint: () => hit } as unknown as Document;
        editorAt({ elementFromPoint: () => null } as unknown as Document);
        const inFrame = editorAt(frame);
        (inFrame.dom as unknown as { contains: (node: unknown) => boolean }).contains = (node) => node === hit;

        expect(viewAtPoint(10, 10, frame)).toBe(inFrame);
    });
});
