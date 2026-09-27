import type { EditorView } from '@codemirror/view';
import type { InputSource } from '../../runtime';
import { liveViewWindows, withPointerDocument } from './views';

type WindowBinding = {
    /** Picks the event target from the owner window: the window itself or its document. */
    on: (win: Window) => EventTarget;
    type: string;
    listener: EventListener;
    options: boolean | AddEventListenerOptions;
    /** Windows this binding is currently attached to. */
    windows: Set<Window>;
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
    // Held from press until release. Entering a pop-out blurs the source window
    // without ending the gesture, so blur must not cancel while the pointer is down.
    let pointerDown = false;
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
    // The drag source's window plus every window that currently hosts an editor
    // (pop-out, card iframe). A pointer event's coordinates belong to the window
    // that received it.
    // Every binding is on the same set of windows: the editor's window and any
    // other window that currently hosts an editor. A newly registered binding
    // joins that set immediately — a window already being listened to must not
    // skip it, or pointerup never arrives and the drag stays held.
    const syncWindows = () => {
        const next = new Set<Window>([ownerWindow(), ...liveViewWindows()]);
        for (const binding of bindings) {
            for (const win of binding.windows) {
                if (next.has(win)) continue;
                binding.on(win).removeEventListener(binding.type, binding.listener, capture(binding.options));
                binding.windows.delete(win);
            }
            for (const win of next) {
                if (binding.windows.has(win)) continue;
                binding.on(win).addEventListener(binding.type, binding.listener, binding.options);
                binding.windows.add(win);
            }
        }
    };
    const listen = <E extends Event>(
        on: WindowBinding['on'],
        type: string,
        handler: (event: E) => void,
        options: boolean | AddEventListenerOptions,
    ): (() => void) => {
        const binding: WindowBinding = {
            on,
            type,
            listener: handler as EventListener,
            options,
            windows: new Set(),
        };
        bindings.add(binding);
        syncWindows();
        return () => {
            bindings.delete(binding);
            for (const win of binding.windows) {
                binding.on(win).removeEventListener(binding.type, binding.listener, capture(binding.options));
            }
            binding.windows.clear();
        };
    };
    const deliver = (event: Event, run: () => void) => {
        const win = (event as Event & { view?: Window | null }).view;
        withPointerDocument(win?.document ?? null, run);
    };

    return {
        onPress: (handler) => {
            const listener = (event: PointerEvent) => {
                pointerDown = true;
                syncWindows();
                deliver(event, () =>
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
                    }),
                );
            };
            view.dom.addEventListener('pointerdown', listener, true);
            return () => view.dom.removeEventListener('pointerdown', listener, true);
        },
        onMove: (handler) => {
            const listener = (event: PointerEvent) => {
                if (event.buttons === 0) pointerDown = false;
                deliver(event, () =>
                    handler({
                        point: { x: event.clientX, y: event.clientY },
                        pointer: { id: event.pointerId, type: event.pointerType },
                        buttons: event.buttons,
                        native: event,
                        claim: () => claimPointerEvent(event),
                    }),
                );
            };
            return listen(theWindow, 'pointermove', listener, { capture: true, passive: false });
        },
        onRelease: (handler) => {
            const listener = (event: PointerEvent) => {
                pointerDown = false;
                deliver(event, () =>
                    handler({
                        point: { x: event.clientX, y: event.clientY },
                        pointer: { id: event.pointerId, type: event.pointerType },
                        native: event,
                        claim: () => claimPointerEvent(event),
                        releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
                    }),
                );
            };
            return listen(theWindow, 'pointerup', listener, { capture: true, passive: false });
        },
        onCancel: (handler) => {
            const pointerCancelListener = (event: PointerEvent) => {
                releasePointerCapture(view.dom, event.pointerId);
                // Crossing into another editor window or out of a card iframe
                // cancels the captured pointer. The gesture continues on the
                // window that receives the next move. A cancel with nowhere
                // else to go still ends it.
                const win = event.view;
                const retarget =
                    pointerDown && (!!win?.frameElement || liveViewWindows().some((other) => other !== win));
                if (retarget) return;
                pointerDown = false;
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
            const cancelFallback = () => {
                pointerDown = false;
                handler({
                    pointer: { id: -1, type: null },
                    reason: 'pointer_cancelled',
                });
            };
            const onWindowBlur = () => {
                if (pointerDown) return;
                cancelFallback();
            };
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

export function elementTarget(event: unknown): Element | null {
    if (typeof event !== 'object' || event === null || !('target' in event)) return null;
    const target = (event as { target?: unknown }).target;
    // 1 is Node.ELEMENT_NODE. Cross-window events fail `instanceof Element`.
    return typeof target === 'object' && target !== null && (target as Node).nodeType === 1
        ? (target as Element)
        : null;
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
