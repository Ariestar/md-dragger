import type { editor } from 'monaco-editor';
import type { CancelInput, InputSource, MoveInput, PressInput, ReleaseInput } from '../../runtime';

export function pointerInput(editor: editor.ICodeEditor): InputSource & { cancel(): void } {
    const pressHandlers = new Set<(input: PressInput) => void>();
    const moveHandlers = new Set<(input: MoveInput) => void>();
    const releaseHandlers = new Set<(input: ReleaseInput) => void>();
    const cancelHandlers = new Set<(input: CancelInput) => void>();
    const escapeHandlers = new Set<() => boolean>();

    let pointerDown = false;
    let activePointerId: number | null = null;

    const domNode = editor.getDomNode();
    if (!domNode) {
        throw new Error('mdDraggerMonaco: editor has no DOM node');
    }
    const win = domNode.ownerDocument.defaultView;
    if (!win) throw new Error('mdDraggerMonaco: editor document has no window');

    const cancel = (native?: PointerEvent) => {
        if (activePointerId === null) return;
        const id = activePointerId;
        pointerDown = false;
        activePointerId = null;
        if (domNode.hasPointerCapture(id)) domNode.releasePointerCapture(id);
        for (const handler of cancelHandlers) {
            handler({
                pointer: { id, type: native?.pointerType ?? null },
                reason: 'pointer_cancelled',
                native,
            });
        }
    };

    const onPointerDown = (event: PointerEvent) => {
        if (pointerDown) return;
        if (event.button !== 0 && event.button !== undefined) return;
        pointerDown = true;
        activePointerId = event.pointerId;

        const input: PressInput = {
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
            claim: () => {
                event.preventDefault();
                event.stopPropagation();
            },
            capture: () => domNode.setPointerCapture(event.pointerId),
            releaseCapture: () => {
                if (domNode.hasPointerCapture(event.pointerId)) domNode.releasePointerCapture(event.pointerId);
            },
        };

        for (const handler of pressHandlers) {
            handler(input);
        }
    };

    const onPointerMove = (event: PointerEvent) => {
        if (!pointerDown || (activePointerId !== null && event.pointerId !== activePointerId)) return;

        const input: MoveInput = {
            point: { x: event.clientX, y: event.clientY },
            pointer: { id: event.pointerId, type: event.pointerType },
            buttons: event.buttons,
            native: event,
            claim: () => {
                event.preventDefault();
                event.stopPropagation();
            },
        };

        for (const handler of moveHandlers) {
            handler(input);
        }
        if (event.buttons === 0) cancel();
    };

    const onPointerUp = (event: PointerEvent) => {
        if (!pointerDown || (activePointerId !== null && event.pointerId !== activePointerId)) return;
        pointerDown = false;
        activePointerId = null;

        const input: ReleaseInput = {
            point: { x: event.clientX, y: event.clientY },
            pointer: { id: event.pointerId, type: event.pointerType },
            native: event,
            claim: () => {
                event.preventDefault();
                event.stopPropagation();
            },
            releaseCapture: () => {
                if (domNode.hasPointerCapture(event.pointerId)) domNode.releasePointerCapture(event.pointerId);
            },
        };

        for (const handler of releaseHandlers) {
            handler(input);
        }
    };

    const onPointerCancel = (event: PointerEvent) => {
        if (!pointerDown || (activePointerId !== null && event.pointerId !== activePointerId)) return;
        cancel(event);
    };

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            for (const handler of escapeHandlers) {
                if (handler()) {
                    cancel();
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
            }
        }
    };

    const bindings: [EventTarget, string, EventListener][] = [
        [domNode, 'pointerdown', onPointerDown as EventListener],
        [win, 'pointermove', onPointerMove as EventListener],
        [win, 'pointerup', onPointerUp as EventListener],
        [win, 'pointercancel', onPointerCancel as EventListener],
        [win, 'keydown', onKeyDown as EventListener],
    ];
    let listening = false;
    const syncListeners = () => {
        const active = [pressHandlers, moveHandlers, releaseHandlers, cancelHandlers, escapeHandlers].some(
            (handlers) => handlers.size > 0,
        );
        if (active === listening) return;
        listening = active;
        for (const [target, type, listener] of bindings) {
            if (active) target.addEventListener(type, listener, { capture: true, passive: false });
            else target.removeEventListener(type, listener, { capture: true });
        }
        if (!active) cancel();
    };
    const subscribe = <T>(handlers: Set<T>, handler: T) => {
        handlers.add(handler);
        syncListeners();
        return () => {
            handlers.delete(handler);
            syncListeners();
        };
    };

    return {
        cancel,
        onPress: (handler) => subscribe(pressHandlers, handler),
        onMove: (handler) => subscribe(moveHandlers, handler),
        onRelease: (handler) => subscribe(releaseHandlers, handler),
        onCancel: (handler) => subscribe(cancelHandlers, handler),
        onEscape: (handler) => subscribe(escapeHandlers, handler),
    };
}
