import type { EditorView } from '@codemirror/view';
import type { InputSource } from '../../runtime';

export function pointerInput(view: EditorView): InputSource {
    return {
        onPress: (handler) => {
            const listener = (event: PointerEvent) => {
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
            window.addEventListener('pointermove', listener, { capture: true, passive: false });
            return () => window.removeEventListener('pointermove', listener, true);
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
            window.addEventListener('pointerup', listener, { capture: true, passive: false });
            return () => window.removeEventListener('pointerup', listener, true);
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
            window.addEventListener('pointercancel', pointerCancelListener, { capture: true, passive: false });
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
                if (document.visibilityState === 'hidden') cancelFallback();
            };
            window.addEventListener('blur', onWindowBlur);
            document.addEventListener('visibilitychange', onVisibilityChange);
            return () => {
                window.removeEventListener('pointercancel', pointerCancelListener, true);
                window.removeEventListener('blur', onWindowBlur);
                document.removeEventListener('visibilitychange', onVisibilityChange);
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
            window.addEventListener('keydown', listener, true);
            return () => window.removeEventListener('keydown', listener, true);
        },
    };
}

export function nativePointerEvent(value: unknown): PointerEvent | null {
    return value instanceof PointerEvent ? value : null;
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
