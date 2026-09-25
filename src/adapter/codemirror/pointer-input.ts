import type { EditorView } from '@codemirror/view';
import type { InputSource } from '../../runtime';

type WindowBinding = {
    /** Picks the event target from the owner window: the window itself or its document. */
    on: (win: Window) => EventTarget;
    type: string;
    listener: EventListener;
    options: boolean | AddEventListenerOptions;
};

const theWindow = (win: Window): EventTarget => win;
const itsDocument = (win: Window): EventTarget => win.document;

export function pointerInput(view: EditorView): InputSource {
    // Window-level listeners follow the window that currently owns the editor.
    // A host may build the editor in one document and move it into another
    // after this input exists (Obsidian moves a canvas card's editor into the
    // card's iframe), so the owner is re-resolved on every press and the
    // listeners move over to it.
    const bindings = new Set<WindowBinding>();
    let boundWindow: Window | null = null;
    const ownerWindow = (): Window => {
        const win = view.dom.ownerDocument.defaultView;
        if (!win) throw new Error('md-dragger: editor document has no window');
        return win;
    };
    // Removal takes { capture } as an object: some EventTarget implementations
    // (Node 24) ignore a bare boolean there.
    const capture = (options: boolean | AddEventListenerOptions): EventListenerOptions => ({
        capture: typeof options === 'boolean' ? options : options.capture === true,
    });
    const followOwnerWindow = () => {
        const win = ownerWindow();
        if (win === boundWindow) return;
        for (const { on, type, listener, options } of bindings) {
            if (boundWindow) on(boundWindow).removeEventListener(type, listener, capture(options));
            on(win).addEventListener(type, listener, options);
        }
        boundWindow = win;
    };
    const listen = <E extends Event>(
        on: WindowBinding['on'],
        type: string,
        handler: (event: E) => void,
        options: boolean | AddEventListenerOptions,
    ): (() => void) => {
        boundWindow ??= ownerWindow();
        const binding: WindowBinding = { on, type, listener: handler as EventListener, options };
        bindings.add(binding);
        on(boundWindow).addEventListener(type, binding.listener, options);
        return () => {
            if (boundWindow) on(boundWindow).removeEventListener(type, binding.listener, capture(options));
            bindings.delete(binding);
        };
    };

    return {
        onPress: (handler) => {
            const listener = (event: PointerEvent) => {
                followOwnerWindow();
                handler({
                    point: { x: event.clientX, y: event.clientY },
                    pointer: { id: event.pointerId, type: event.pointerType },
                    button: event.button,
                    modifiers: {
                        altKey: event.altKey,
                        ctrlKey: event.ctrlKey,
                        metaKey: event.metaKey,
                        shiftKey: event.shiftKey,
                    },
                    native: event,
                    claim: () => claimPointerEvent(event),
                    capture: () => capturePointer(view.dom, event.pointerId),
                    releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
                });
            };
            view.dom.addEventListener('pointerdown', listener, true);
            return () => view.dom.removeEventListener('pointerdown', listener, true);
        },
        onMove: (handler) => {
            const listener = (event: PointerEvent) => {
                handler({
                    point: { x: event.clientX, y: event.clientY },
                    pointer: { id: event.pointerId, type: event.pointerType },
                    native: event,
                    claim: () => claimPointerEvent(event),
                });
            };
            return listen(theWindow, 'pointermove', listener, { capture: true, passive: false });
        },
        onRelease: (handler) => {
            const listener = (event: PointerEvent) => {
                handler({
                    point: { x: event.clientX, y: event.clientY },
                    pointer: { id: event.pointerId, type: event.pointerType },
                    native: event,
                    claim: () => claimPointerEvent(event),
                    releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
                });
            };
            return listen(theWindow, 'pointerup', listener, { capture: true, passive: false });
        },
        onCancel: (handler) => {
            const pointerCancelListener = (event: PointerEvent) => {
                handler({
                    pointer: { id: event.pointerId, type: event.pointerType },
                    reason: 'pointer_cancelled',
                    native: event,
                    releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
                });
            };
            // A drag can lose its pointer stream entirely — window blur or tab
            // hidden — with no pointerup/pointercancel ever firing, leaving the
            // drag state and the host's grabbing cursor stuck. Force-cancel then.
            const cancelFallback = () =>
                handler({
                    pointer: { id: -1, type: null },
                    reason: 'pointer_cancelled',
                });
            const onWindowBlur = () => cancelFallback();
            const onVisibilityChange = () => {
                if (view.dom.ownerDocument.visibilityState === 'hidden') cancelFallback();
            };
            const unlisten = [
                listen(theWindow, 'pointercancel', pointerCancelListener, { capture: true, passive: false }),
                listen(theWindow, 'blur', onWindowBlur, false),
                listen(itsDocument, 'visibilitychange', onVisibilityChange, false),
            ];
            return () => {
                for (const off of unlisten) off();
            };
        },
        onEscape: (handler) => {
            const listener = (event: KeyboardEvent) => {
                if (event.key !== 'Escape') return;
                // Only claim the key when a gesture was actually active —
                // an idle editor must not swallow Obsidian's own Escape
                // (close modals, menus, command palette).
                if (handler()) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            };
            return listen(theWindow, 'keydown', listener, true);
        },
    };
}

// Cross-window safe checks: events and elements from an iframe or a pop-out
// window are instances of that window's classes, so `instanceof` rejects them.
export function nativePointerEvent(value: unknown): PointerEvent | null {
    return typeof value === 'object' && value !== null && typeof (value as PointerEvent).pointerId === 'number'
        ? (value as PointerEvent)
        : null;
}

export function elementTarget(event: Event | null): Element | null {
    const target = event?.target;
    // 1 is Node.ELEMENT_NODE.
    return target && (target as Node).nodeType === 1 ? (target as Element) : null;
}

function claimPointerEvent(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
}

function capturePointer(target: HTMLElement, pointerId: number): void {
    try {
        target.setPointerCapture(pointerId);
    } catch {
        // Pointer capture can fail when the pointer is no longer active.
    }
}

function releasePointerCapture(target: HTMLElement, pointerId: number): void {
    try {
        target.releasePointerCapture(pointerId);
    } catch {
        // Pointer capture can fail when the pointer is already released.
    }
}
