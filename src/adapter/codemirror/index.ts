import {
  RangeSetBuilder,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  type BlockInfo as ViewBlockInfo,
  ViewPlugin,
  type ViewUpdate,
  gutter,
} from '@codemirror/view';
import {
  DraggerRuntime,
  type Point,
  type DragPreview,
  type DropCommit,
  type InputSource,
  type PressInput,
  type Config,
} from '../../runtime';
import {
  BlockType,
  detectBlock,
  type BlockSelection,
  type DropTarget,
  type ListDropTarget,
} from '../../domain';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';
import type { ParsedLine } from '../../domain/markdown/document-types';

const HANDLE_CLASS = 'md-dragger-cm-handle';
const EDITOR_CLASS = 'md-dragger-cm-editor';
const LIST_INTENT_THRESHOLD_PX = 24;

export type MdDraggerCodeMirrorOptions = {
  config?: Config;
};

export function mdDraggerCodeMirrorExtension(options: MdDraggerCodeMirrorOptions = {}): Extension {
  return [
    EditorView.editorAttributes.of({ class: EDITOR_CLASS }),
    blockSelectionField,
    dragHandleGutter(options),
    ViewPlugin.fromClass(class {
      private readonly runtime: DraggerRuntime;
      private readonly preview: DropPreviewRenderer;

      constructor(private readonly view: EditorView) {
        this.preview = new DropPreviewRenderer(view);
        this.runtime = new DraggerRuntime({
          input: createPointerInputSource(view),
          document: {
            getDoc: () => view.state.doc,
          },
          locate: {
            sourceLineFromInput: (input) => sourceLineFromInput(view, input),
            resolveDropTarget: (point, context) => resolveDropTarget(view, point, context.selection, options),
          },
          commit: {
            apply: (commit) => applyCommit(view, commit),
          },
          output: {
            onPreview: (value) => this.preview.render(value),
            onSelection: (selection) => {
              view.dispatch({ effects: setBlockSelectionEffect.of(selection) });
            },
          },
          config: () => ({
            longPressMs: 0,
            ...resolveConfig(options.config),
          }),
        });
        this.runtime.mount();
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.geometryChanged || update.viewportChanged) {
          this.preview.scheduleRefresh();
        }
      }

      destroy(): void {
        this.runtime.destroy();
        this.preview.destroy();
      }
    }),
  ];
}

const setBlockSelectionEffect = StateEffect.define<BlockSelection | null>();

const selectedLineDecoration = Decoration.line({
  attributes: { class: 'md-dragger-cm-selected-line' },
});

const blockSelectionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update: (selectionDecorations, transaction) => {
    let next = selectionDecorations.map(transaction.changes);
    for (const effect of transaction.effects) {
      if (effect.is(setBlockSelectionEffect)) {
        next = buildSelectionDecorations(transaction.state.doc, effect.value);
      }
    }
    return next;
  },
  provide: (field) => EditorView.decorations.from(field),
});

function buildSelectionDecorations(doc: { lines: number; line(n: number): { from: number } }, selection: BlockSelection | null): DecorationSet {
  if (!selection || selection.ranges.length === 0) return Decoration.none;
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of selection.ranges) {
    const startLine = Math.max(1, Math.min(doc.lines, range.startLine + 1));
    const endLine = Math.max(startLine, Math.min(doc.lines, range.endLine + 1));
    for (let lineNumber = startLine; lineNumber <= endLine; lineNumber++) {
      const line = doc.line(lineNumber);
      builder.add(line.from, line.from, selectedLineDecoration);
    }
  }
  return builder.finish();
}

class DragHandleMarker extends GutterMarker {
  toDOM(): HTMLElement {
    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = HANDLE_CLASS;
    handle.setAttribute('aria-label', 'Drag markdown block');
    handle.textContent = '⋮⋮';
    return handle;
  }
}

const dragHandleMarker = new DragHandleMarker();

function dragHandleGutter(options: MdDraggerCodeMirrorOptions): Extension {
  return gutter({
    class: 'md-dragger-cm-gutter',
    lineMarker: (view, line) => {
      if (!isDraggableBlockStart(view, line, options)) return null;
      return dragHandleMarker;
    },
  });
}

function isDraggableBlockStart(view: EditorView, line: ViewBlockInfo, options: MdDraggerCodeMirrorOptions): boolean {
  const docLine = view.state.doc.lineAt(line.from);
  if (docLine.from !== line.from) return false;
  const block = detectBlock({ doc: view.state.doc }, docLine.number, {
    tabSize: resolveTabSize(options),
  });
  return block?.startLine === docLine.number - 1;
}

function sourceLineFromInput(view: EditorView, input: PressInput): number | null {
  const event = nativePointerEvent(input.native);
  const target = event?.target instanceof Element ? event.target : null;
  const handle = target?.closest(`.${HANDLE_CLASS}`);
  if (!handle) return null;
  return lineNumberFromPoint(view, input.point);
}

function lineNumberFromPoint(view: EditorView, point: Point): number | null {
  const contentRect = view.contentDOM.getBoundingClientRect();
  if (point.y <= contentRect.top) return 1;
  if (point.y >= contentRect.bottom) return view.state.doc.lines + 1;

  const pos = view.posAtCoords({ x: Math.max(contentRect.left + 1, point.x), y: point.y }, false);
  if (typeof pos !== 'number') return null;
  return view.state.doc.lineAt(pos).number;
}

function resolveDropTarget(
  view: EditorView,
  point: Point,
  selection: BlockSelection,
  options: MdDraggerCodeMirrorOptions
): DropTarget | null {
  const targetLineNumber = lineNumberFromPoint(view, point);
  if (targetLineNumber === null) return null;

  return {
    targetLineNumber,
    placement: 'before',
    listIntent: resolveListIntent(view, point, selection, targetLineNumber, options),
  };
}

function resolveListIntent(
  view: EditorView,
  point: Point,
  selection: BlockSelection,
  targetLineNumber: number,
  options: MdDraggerCodeMirrorOptions
): ListDropTarget | undefined {
  if (selection.anchorBlock.type !== BlockType.ListItem) return undefined;

  const lineParsing = createLineParsingContext(resolveTabSize(options));
  const sourceBase = firstListLine(selection.anchorBlock.content, lineParsing.parseLine);
  if (!sourceBase) return undefined;

  const context = findListContext(view, targetLineNumber, lineParsing.parseLine);
  if (!context) {
    return {
      mode: 'sibling',
      contextLineNumber: targetLineNumber,
      targetIndentWidth: 0,
    };
  }

  const indentUnitWidth = lineParsing.getIndentUnitWidth(context.parsed.indentRaw || sourceBase.indentRaw);
  const markerX = markerStartX(view, context.lineNumber, context.parsed);
  const horizontalDelta = markerX === null ? 0 : point.x - markerX;
  const mode = horizontalDelta >= LIST_INTENT_THRESHOLD_PX
    ? 'child'
    : horizontalDelta <= -LIST_INTENT_THRESHOLD_PX
      ? 'outdent'
      : 'sibling';
  const targetIndentWidth = Math.max(0, context.parsed.indentWidth + (
    mode === 'child' ? indentUnitWidth : mode === 'outdent' ? -indentUnitWidth : 0
  ));

  return {
    mode,
    contextLineNumber: context.lineNumber,
    targetIndentWidth,
  };
}

function firstListLine(text: string, parseLine: (line: string) => ParsedLine): { indentRaw: string } | null {
  for (const line of text.split('\n')) {
    const parsed = parseLine(line);
    if (parsed.isListItem) {
      return { indentRaw: parsed.indentRaw };
    }
  }
  return null;
}

function findListContext(
  view: EditorView,
  targetLineNumber: number,
  parseLine: (line: string) => ParsedLine
): { lineNumber: number; parsed: ParsedLine } | null {
  const doc = view.state.doc;
  const candidates = [
    Math.min(targetLineNumber, doc.lines),
    targetLineNumber - 1,
    targetLineNumber + 1,
  ];
  const seen = new Set<number>();
  for (const lineNumber of candidates) {
    if (lineNumber < 1 || lineNumber > doc.lines || seen.has(lineNumber)) continue;
    seen.add(lineNumber);
    const parsed = parseLine(doc.line(lineNumber).text);
    if (parsed.isListItem) return { lineNumber, parsed };
  }
  return null;
}

function markerStartX(view: EditorView, lineNumber: number, parsed: ParsedLine): number | null {
  const line = view.state.doc.line(lineNumber);
  const offset = parsed.quotePrefix.length + parsed.indentRaw.length;
  const rect = view.coordsAtPos(Math.min(line.to, line.from + offset), 1);
  return rect?.left ?? null;
}

function createPointerInputSource(view: EditorView): InputSource {
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

class DropPreviewRenderer {
  private readonly indicator: HTMLDivElement;
  private current: DragPreview | null = null;
  private refreshFrame: number | null = null;

  constructor(private readonly view: EditorView) {
    this.indicator = document.createElement('div');
    this.indicator.className = 'md-dragger-cm-drop-indicator';
    this.indicator.hidden = true;
    document.body.appendChild(this.indicator);
  }

  render(preview: DragPreview | null): void {
    this.current = preview;
    if (!preview || !preview.allowed || preview.targetLineNumber === null) {
      this.indicator.hidden = true;
      return;
    }

    const lineNumber = Math.min(preview.targetLineNumber, this.view.state.doc.lines);
    const line = this.view.state.doc.line(lineNumber);
    const rect = this.view.coordsAtPos(line.from, -1);
    const contentRect = this.view.contentDOM.getBoundingClientRect();
    if (!rect) {
      this.indicator.hidden = true;
      return;
    }

    const indentOffset = (preview.target?.listIntent?.targetIndentWidth ?? 0) * defaultCharacterWidth(this.view);
    this.indicator.hidden = false;
    this.indicator.style.left = `${contentRect.left + indentOffset}px`;
    this.indicator.style.top = `${preview.targetLineNumber > this.view.state.doc.lines ? rect.bottom : rect.top}px`;
    this.indicator.style.width = `${Math.max(16, contentRect.width - indentOffset)}px`;
  }

  scheduleRefresh(): void {
    if (this.refreshFrame !== null) return;
    this.refreshFrame = window.requestAnimationFrame(() => {
      this.refreshFrame = null;
      this.render(this.current);
    });
  }

  destroy(): void {
    if (this.refreshFrame !== null) {
      window.cancelAnimationFrame(this.refreshFrame);
      this.refreshFrame = null;
    }
    this.indicator.remove();
  }
}

function applyCommit(view: EditorView, commit: DropCommit): void {
  if (commit.changes.length === 0) return;
  view.dispatch({ changes: commit.changes });
}

function resolveConfig(config: Config | undefined) {
  return typeof config === 'function' ? config() : config;
}

function resolveTabSize(options: MdDraggerCodeMirrorOptions): number {
  return resolveConfig(options.config)?.tabSize ?? 4;
}

function defaultCharacterWidth(view: EditorView): number {
  const width = (view as unknown as { defaultCharacterWidth?: number }).defaultCharacterWidth;
  return typeof width === 'number' && width > 0 ? width : 8;
}

function nativePointerEvent(value: unknown): PointerEvent | null {
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
