import type { Extension } from '@codemirror/state';
import {
  HANDLE_CLASS,
  lineNumberFromPoint,
  mdDragger,
  sourceLineFromInput as handleSourceLineFromInput,
} from 'md-dragger/adapter/codemirror';
import type { PressInput } from 'md-dragger/runtime';
import { dropIndicator, dropIndicatorOnChange } from './drop-indicator';
import { hybridMarkdown } from './hybrid-markdown';
import { selectionHighlight, selectionHighlightOnChange } from './selection-highlight';

// Platform-neutral host wiring for the website demo.
// Same package seams Obsidian uses, with no Obsidian code:
//   gestureConfig  — host numbers for DefaultUx
//   locate         — handle always; touch/pen also arms on the content row
//   visuals        — drop line + selection paint + hybrid math/table/hr
export type DemoUxOptions = {
  multiSelectMs?: number;
  dragArmMs?: number;
  // Touch/pen press on the content row arms a gesture (row-as-handle).
  // Mouse still requires the handle. Default true.
  rowPressOnTouch?: boolean;
};

export function demoDraggerExtensions(options: DemoUxOptions = {}): Extension[] {
  const multiSelectMs = options.multiSelectMs ?? 700;
  // Coarse pointer (touch) needs an arm delay so a scroll pan does not start a
  // drag; fine pointer (mouse) stays 0 so handle-drag is immediate — same split
  // Obsidian uses between mobileDragLongPressMs and desktop dragArmMs=0.
  const dragArmMs = options.dragArmMs
    ?? (typeof window !== 'undefined'
      && window.matchMedia?.('(pointer: coarse)').matches
      ? 200
      : 0);
  const rowPressOnTouch = options.rowPressOnTouch !== false;

  return [
    ...mdDragger({
      gestureConfig: {
        dragArmMs,
        multiSelectMs,
        multiSelectEnabled: true,
        dragStartMoveThresholdPx: 4,
        dragCancelMoveThresholdPx: Number.POSITIVE_INFINITY,
      },
      // Direct callback — avoids dual-instance StateEffect under Vite source
      // conditions. See drop-indicator.ts / selection-highlight.ts.
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
              return lineNumberFromPoint(view, input.point);
            },
          })
        : undefined,
    }),
    hybridMarkdown(),
    dropIndicator(),
    selectionHighlight(),
  ];
}
