import type { Extension } from '@codemirror/state';
import {
  HANDLE_CLASS,
  lineAtPoint,
  mdDragger,
  sourceLineFromInput as handleSourceLineFromInput,
} from 'md-dragger/adapter/codemirror';
import type { PressInput } from 'md-dragger/runtime';
import { dropIndicator, dropIndicatorOnChange } from './drop-indicator';
import { selectionHighlight, selectionHighlightOnChange } from './selection-highlight';

// Host wiring for the website demo: gesture config, locate, drop line, selection paint.
export type DemoUxOptions = {
  multiSelectMs?: number;
  dragArmMs?: number;
  rowPressOnTouch?: boolean;
};

export function demoDraggerExtensions(options: DemoUxOptions = {}): Extension[] {
  const multiSelectMs = options.multiSelectMs ?? 700;
  const dragArmMs = options.dragArmMs
    ?? (typeof window !== 'undefined'
      && window.matchMedia?.('(pointer: coarse)').matches
      ? 200
      : 0);
  const rowPressOnTouch = options.rowPressOnTouch !== false;

  return [
    ...mdDragger({
      config: {
        tabSize: 4,
        listIndentUnit: 2,
      },
      ux: {
        gesture: {
          dragArmMs,
          multiSelectMs,
          multiSelectEnabled: true,
          dragStartMoveThresholdPx: 4,
          dragCancelMoveThresholdPx: Number.POSITIVE_INFINITY,
        },
      },
      onChange: (result) => {
        dropIndicatorOnChange(result);
        selectionHighlightOnChange(result);
      },
      locate: rowPressOnTouch
        ? (view) => ({
            sourceLineFromInput: (input: PressInput) => {
              const fromHandle = handleSourceLineFromInput(view, input);
              if (fromHandle !== null) return fromHandle;
              const pointerType = input.pointer.type;
              if (pointerType !== 'touch' && pointerType !== 'pen') return null;
              const event = input.native instanceof PointerEvent ? input.native : null;
              const target = event?.target instanceof Element ? event.target : null;
              if (target && !view.dom.contains(target)) return null;
              if (
                target
                && !view.contentDOM.contains(target)
                && !target.closest(`.${HANDLE_CLASS}`)
                && !target.closest('.cm-gutters')
              ) {
                return null;
              }
              return lineAtPoint(view, input.point);
            },
          })
        : undefined,
    }),
    dropIndicator(),
    selectionHighlight(),
  ];
}
