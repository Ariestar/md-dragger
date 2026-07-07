import { EditorView } from '@codemirror/view';
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
      const listener = (event: PointerEvent) => {
        handler({
          pointer: { id: event.pointerId, type: event.pointerType },
          reason: 'pointer_cancelled',
          native: event,
          releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
        });
      };
      window.addEventListener('pointercancel', listener, { capture: true, passive: false });
      return () => window.removeEventListener('pointercancel', listener, true);
    },
    onEscape: (handler) => {
      const listener = (event: KeyboardEvent) => {
        if (event.key !== 'Escape') return;
        handler();
        event.preventDefault();
        event.stopPropagation();
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
