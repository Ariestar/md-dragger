import type { editor } from 'monaco-editor';
import type { CancelInput, InputSource, MoveInput, PressInput, ReleaseInput } from '../../runtime';

export function pointerInput(editor: editor.ICodeEditor): InputSource {
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
    const win = domNode.ownerDocument.defaultView ?? window;

    const onPointerDown = (event: PointerEvent) => {
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
        };

        for (const handler of moveHandlers) {
            handler(input);
        }
    };

    const onPointerUp = (event: PointerEvent) => {
        if (!pointerDown || (activePointerId !== null && event.pointerId !== activePointerId)) return;
        pointerDown = false;
        activePointerId = null;

        const input: ReleaseInput = {
            point: { x: event.clientX, y: event.clientY },
            pointer: { id: event.pointerId, type: event.pointerType },
            native: event,
        };

        for (const handler of releaseHandlers) {
            handler(input);
        }
    };

    const onPointerCancel = (event: PointerEvent) => {
        if (!pointerDown || (activePointerId !== null && event.pointerId !== activePointerId)) return;
        pointerDown = false;
        activePointerId = null;

        const input: CancelInput = {
            pointer: { id: event.pointerId, type: event.pointerType },
            reason: 'pointer_cancelled',
            native: event,
        };

        for (const handler of cancelHandlers) {
            handler(input);
        }
    };

    const onKeyDown = (event: KeyboardEvent) => {
        if (event.key === 'Escape') {
            for (const handler of escapeHandlers) {
                if (handler()) {
                    event.preventDefault();
                    event.stopPropagation();
                    break;
                }
            }
        }
    };

    domNode.addEventListener('pointerdown', onPointerDown);
    win.addEventListener('pointermove', onPointerMove, { capture: true });
    win.addEventListener('pointerup', onPointerUp, { capture: true });
    win.addEventListener('pointercancel', onPointerCancel, { capture: true });
    win.addEventListener('keydown', onKeyDown, { capture: true });

    return {
        onPress: (handler) => {
            pressHandlers.add(handler);
            return () => pressHandlers.delete(handler);
        },
        onMove: (handler) => {
            moveHandlers.add(handler);
            return () => moveHandlers.delete(handler);
        },
        onRelease: (handler) => {
            releaseHandlers.add(handler);
            return () => releaseHandlers.delete(handler);
        },
        onCancel: (handler) => {
            cancelHandlers.add(handler);
            return () => cancelHandlers.delete(handler);
        },
        onEscape: (handler) => {
            escapeHandlers.add(handler);
            return () => escapeHandlers.delete(handler);
        },
    };
}
