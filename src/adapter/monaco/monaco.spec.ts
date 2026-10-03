import type { editor } from 'monaco-editor';
import { describe, expect, it, vi } from 'vitest';
import type { PressInput } from '../../runtime';
import { applyCommit } from './commit';
import { type MdDraggerMonacoOptions, resolveConfig, resolveListIndentWidthPx } from './config';
import { monacoDoc } from './doc';
import { dropSeam, lineBand } from './geometry';
import { mdDraggerMonaco } from './index';
import { lineAtPoint, sourceLineFromInput } from './locate';
import { pointerInput } from './pointer-input';
import { DragHighlightManager, DropSeamWidget } from './widget';

function createMockModel(initial: string) {
    let content = initial;
    let version = 1;
    let lines: string[];
    let offsets: number[];
    const setValue = (value: string) => {
        content = value;
        version++;
        lines = value.split(/\r?\n/);
        offsets = [0];
        for (const match of value.matchAll(/\n/g)) offsets.push(match.index + 1);
    };
    setValue(initial);
    const model = {
        getVersionId: () => version,
        getValue: () => content,
        getLineCount: () => lines.length,
        getLineContent: (n: number) => lines[n - 1],
        getOffsetAt: ({ lineNumber, column }: { lineNumber: number; column: number }) =>
            offsets[lineNumber - 1] + column - 1,
        getPositionAt: (offset: number) => {
            let index = 0;
            while (index < offsets.length - 1 && offsets[index + 1] <= offset) index++;
            return { lineNumber: index + 1, column: offset - offsets[index] + 1 };
        },
        setValue,
    } as unknown as editor.ITextModel;
    return model;
}

function createMockEditor(initial: editor.ITextModel | null) {
    let model = initial;
    const modelListeners = new Set<() => void>();
    const contentListeners = new Set<() => void>();
    const disposeListeners = new Set<() => void>();
    const subscribe = (listeners: Set<() => void>, listener: () => void) => {
        listeners.add(listener);
        return { dispose: () => listeners.delete(listener) };
    };
    const win = new EventTarget();
    const domNode = Object.assign(new EventTarget(), {
        ownerDocument: {
            createElement: () => ({
                style: {},
                classList: { add: vi.fn(), remove: vi.fn() },
                remove: vi.fn(),
            }),
            defaultView: win,
        },
        getBoundingClientRect: () => ({ left: 100, top: 50, width: 800, height: 600 }),
        contains: vi.fn(() => true),
        setPointerCapture: vi.fn(),
        hasPointerCapture: vi.fn(() => true),
        releasePointerCapture: vi.fn(),
    });
    const decorations = { set: vi.fn(), clear: vi.fn() };
    const emitContent = () => {
        for (const listener of contentListeners) listener();
    };
    const native = {
        getModel: () => model,
        getDomNode: () => domNode,
        addOverlayWidget: vi.fn(),
        removeOverlayWidget: vi.fn(),
        createDecorationsCollection: vi.fn(() => decorations),
        onDidChangeModel: (listener: () => void) => subscribe(modelListeners, listener),
        onDidChangeModelContent: (listener: () => void) => subscribe(contentListeners, listener),
        onDidDispose: (listener: () => void) => subscribe(disposeListeners, listener),
        getLayoutInfo: () => ({ contentLeft: 30, contentWidth: 500 }),
        getScrollTop: () => 0,
        getScrollLeft: () => 0,
        getTopForLineNumber: (line: number) => (line - 1) * 20,
        getBottomForLineNumber: (line: number) => line * 20,
        getTargetAtClientPoint: vi.fn(() => null),
        pushUndoStop: vi.fn(),
        executeEdits: vi.fn((_source: string, operations: editor.IIdentifiedSingleEditOperation[]) => {
            if (!model) throw new Error('No model');
            const changes = operations.map(({ range, text }) => ({
                from: model.getOffsetAt({ lineNumber: range.startLineNumber, column: range.startColumn }),
                to: model.getOffsetAt({ lineNumber: range.endLineNumber, column: range.endColumn }),
                text,
            }));
            let value = model.getValue();
            for (const change of changes.sort((a, b) => b.from - a.from)) {
                value = value.slice(0, change.from) + change.text + value.slice(change.to);
            }
            model.setValue(value);
            emitContent();
            return true;
        }),
    };
    return {
        native,
        editor: native as unknown as editor.ICodeEditor,
        domNode,
        win,
        decorations,
        emitContent,
        setModel(next: editor.ITextModel | null) {
            model = next;
            for (const listener of modelListeners) listener();
        },
        disposeEditor() {
            for (const listener of disposeListeners) listener();
        },
    };
}

const options: MdDraggerMonacoOptions = {
    config: { tabSize: 4, listIndentUnit: 4 },
    listIndentWidthPx: 24,
};

function pointer(target: EventTarget, type: string, id = 1) {
    const event = Object.assign(new Event(type, { cancelable: true }), {
        pointerId: id,
        pointerType: 'mouse',
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1,
        clientX: 150,
        clientY: type === 'pointerdown' ? 60 : 150,
    });
    target.dispatchEvent(event);
    return event;
}

describe('adapter/monaco doc', () => {
    it('keeps immutable identity within each model version', () => {
        const model = createMockModel('# Heading\nParagraph');
        const doc = monacoDoc(model);
        expect(monacoDoc(model)).toBe(doc);
        expect(monacoDoc(createMockModel(model.getValue()))).not.toBe(doc);
        model.setValue('Changed');
        expect(monacoDoc(model)).not.toBe(doc);
        expect(monacoDoc(model).line(1).text).toBe('Changed');
        expect(doc.lines).toBe(2);
        expect(doc.line(2)).toEqual({ from: 10, to: 19, text: 'Paragraph' });
        expect(doc.sliceString(0, 9)).toBe('# Heading');
    });

    it('preserves native CRLF and UTF-16 offsets', () => {
        const doc = monacoDoc(createMockModel('😀\r\nnext'));
        expect(doc.length).toBe(8);
        expect(doc.line(1)).toEqual({ from: 0, to: 2, text: '😀' });
        expect(doc.line(2)).toEqual({ from: 4, to: 8, text: 'next' });
        expect(doc.lineAt(3).number).toBe(1);
        expect(doc.lineAt(4).number).toBe(2);
        expect(doc.sliceString(2, 4)).toBe('\r\n');
    });

    it.each([0, 2, 1.5, NaN])('rejects invalid line %s', (line) => {
        expect(() => monacoDoc(createMockModel('one')).line(line)).toThrow(RangeError);
    });
});

describe('adapter/monaco commit', () => {
    it('applies all edits against the same snapshot in one undoable batch', () => {
        const model = createMockModel('hello world');
        const host = createMockEditor(model);
        const doc = monacoDoc(model);
        applyCommit(host.editor, [
            { doc, changes: [{ from: 0, to: 5, insert: 'hi' }] },
            { doc, changes: [{ from: 6, to: 11, insert: 'monaco' }] },
        ]);
        expect(model.getValue()).toBe('hi monaco');
        expect(host.native.executeEdits).toHaveBeenCalledTimes(1);
        expect(host.native.pushUndoStop).toHaveBeenCalledTimes(2);
    });

    it('rejects every foreign or stale document before any edit', () => {
        const model = createMockModel('text');
        const host = createMockEditor(model);
        const stale = monacoDoc(model);
        model.setValue('new');
        for (const doc of [stale, monacoDoc(createMockModel('new'))]) {
            expect(() =>
                applyCommit(host.editor, [
                    { doc: monacoDoc(model), changes: [{ from: 0, to: 0, insert: 'a' }] },
                    { doc, changes: [{ from: 0, to: 0, insert: 'b' }] },
                ]),
            ).toThrow('stale or different model');
        }
        expect(host.native.executeEdits).not.toHaveBeenCalled();
        expect(host.native.pushUndoStop).not.toHaveBeenCalled();
    });

    it('reports missing models and rejected edits', () => {
        expect(() => applyCommit(createMockEditor(null).editor, [])).toThrow('no model');
        const model = createMockModel('text');
        const host = createMockEditor(model);
        host.native.executeEdits.mockReturnValue(false);
        expect(() =>
            applyCommit(host.editor, [{ doc: monacoDoc(model), changes: [{ from: 0, to: 0, insert: 'x' }] }]),
        ).toThrow('rejected');
    });
});

describe('adapter/monaco config', () => {
    it.each([0, -1, NaN, Infinity])('rejects invalid metrics %s', (value) => {
        expect(() => resolveConfig({ tabSize: value, listIndentUnit: 4 })).toThrow();
        expect(() => resolveConfig({ tabSize: 4, listIndentUnit: value })).toThrow();
        expect(() => resolveListIndentWidthPx({ listIndentWidthPx: value }, createMockEditor(null).editor)).toThrow();
    });
});

describe('adapter/monaco geometry and highlighting', () => {
    it('uses native wrapped line bounds and horizontal scroll for bands and EOF seams', () => {
        const model = createMockModel('wrapped');
        const host = createMockEditor(model);
        host.native.getBottomForLineNumber = () => 60;
        host.native.getScrollTop = () => 10;
        host.native.getScrollLeft = () => 15;
        expect(lineBand(host.editor, 1, options)).toEqual({ left: 115, right: 630, top: 40, bottom: 100 });
        expect(dropSeam(host.editor, { doc: monacoDoc(model), line: 2, parent: null }, options)).toEqual({
            left: 115,
            right: 630,
            y: 100,
        });
    });

    it('highlights disjoint ranges without selecting the gap', () => {
        const host = createMockEditor(createMockModel('one\ntwo\nthree'));
        const highlights = new DragHighlightManager(host.editor);
        highlights.update([
            { startLine: 1, endLine: 1 },
            { startLine: 3, endLine: 3 },
        ]);
        expect(host.decorations.set.mock.calls[0][0].map((item: editor.IModelDeltaDecoration) => item.range)).toEqual([
            { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
            { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 1 },
        ]);
        highlights.clear();
        expect(host.decorations.clear).toHaveBeenCalledOnce();
    });

    it('positions the native overlay relative to an offset editor', () => {
        const model = createMockModel('one');
        const host = createMockEditor(model);
        const widget = new DropSeamWidget(host.domNode.ownerDocument as unknown as Document);
        widget.update(host.editor, { doc: monacoDoc(model), line: 2, parent: null }, false, options);
        expect(widget.getDomNode().style).toMatchObject({
            position: 'absolute',
            left: '30px',
            top: '20px',
            width: '500px',
        });
    });

    it('only resolves handles owned by the editor and native hit results', () => {
        const host = createMockEditor(createMockModel('one'));
        const handle = { getAttribute: () => '1' };
        const input = { point: { x: 0, y: 0 }, native: { target: { closest: () => handle } } } as PressInput;
        expect(sourceLineFromInput(host.editor, input)).toBe(1);
        host.domNode.contains.mockReturnValue(false);
        expect(sourceLineFromInput(host.editor, input)).toBeNull();
        expect(sourceLineFromInput(host.editor, { ...input, native: { target: {} } })).toBeNull();
        expect(lineAtPoint(host.editor, { x: 0, y: 9999 })).toBeNull();
    });
});

describe('adapter/monaco pointer input', () => {
    it('releases capture when its last subscription is removed mid-press', () => {
        const host = createMockEditor(null);
        const source = pointerInput(host.editor);
        const unsubscribe = source.onPress((input) => input.capture?.());
        pointer(host.domNode, 'pointerdown');
        unsubscribe();
        expect(host.domNode.releasePointerCapture).toHaveBeenCalledWith(1);
    });
    it('claims and captures active input, ignores a second pointer, and detaches listeners', () => {
        const host = createMockEditor(null);
        const add = vi.spyOn(host.win, 'addEventListener');
        const remove = vi.spyOn(host.win, 'removeEventListener');
        const source = pointerInput(host.editor);
        expect(add).not.toHaveBeenCalled();
        const press = vi.fn((input: PressInput) => {
            input.claim?.();
            input.capture?.();
        });
        const move = vi.fn();
        const release = vi.fn();
        const dispose = [source.onPress(press), source.onMove(move), source.onRelease(release)];
        expect(pointer(host.domNode, 'pointerdown').defaultPrevented).toBe(true);
        pointer(host.domNode, 'pointerdown', 2);
        pointer(host.win, 'pointermove', 2);
        pointer(host.win, 'pointermove');
        pointer(host.win, 'pointerup');
        expect(press).toHaveBeenCalledOnce();
        expect(move).toHaveBeenCalledOnce();
        expect(release).toHaveBeenCalledOnce();
        release.mock.calls[0][0].releaseCapture();
        expect(host.domNode.setPointerCapture).toHaveBeenCalledWith(1);
        expect(host.domNode.releasePointerCapture).toHaveBeenCalledWith(1);
        for (const unsubscribe of dispose) unsubscribe();
        expect(remove).toHaveBeenCalledTimes(4);
        const again = source.onPress(press);
        pointer(host.domNode, 'pointerdown');
        pointer(host.win, 'pointermove');
        expect(move).toHaveBeenCalledOnce();
        again();
    });
});

describe('adapter/monaco lifecycle', () => {
    it('ends the input gesture on Escape so later moves cannot restart it', () => {
        const host = createMockEditor(createMockModel('one'));
        const onDragStart = vi.fn();
        const onCancel = vi.fn();
        const dispose = mdDraggerMonaco(host.editor, {
            ...options,
            locate: { sourceLineFromInput: () => 1 },
            ux: { modules: [{ name: 'test', onDragStart, onCancel }] },
        });
        pointer(host.domNode, 'pointerdown');
        pointer(host.win, 'pointermove');
        const escapeEvent = Object.assign(new Event('keydown', { cancelable: true }), { key: 'Escape' });
        host.win.dispatchEvent(escapeEvent);
        pointer(host.win, 'pointermove');
        pointer(host.win, 'pointerup');
        expect(escapeEvent.defaultPrevented).toBe(true);
        expect(onDragStart).toHaveBeenCalledOnce();
        expect(onCancel).toHaveBeenCalledOnce();
        expect(host.native.executeEdits).not.toHaveBeenCalled();
        dispose();
    });
    it('mounts native widgets and disposes once when the editor is destroyed', () => {
        const host = createMockEditor(createMockModel('text'));
        const remove = vi.spyOn(host.win, 'removeEventListener');
        const dispose = mdDraggerMonaco(host.editor, options);
        expect(host.native.addOverlayWidget).toHaveBeenCalledWith(expect.any(DropSeamWidget));
        host.disposeEditor();
        dispose();
        expect(host.native.removeOverlayWidget).toHaveBeenCalledOnce();
        expect(remove).toHaveBeenCalledTimes(4);
    });

    it('requires a real editor DOM and owning window before allocating widgets', () => {
        const host = createMockEditor(null);
        host.native.getDomNode = () => null as unknown as typeof host.domNode;
        expect(() => mdDraggerMonaco(host.editor, options)).toThrow('no DOM node');
        const detached = createMockEditor(null);
        detached.domNode.ownerDocument.defaultView = null as unknown as EventTarget;
        expect(() => mdDraggerMonaco(detached.editor, options)).toThrow('no window');
        expect(detached.native.addOverlayWidget).not.toHaveBeenCalled();
    });

    it.each(['content', 'model'] as const)('cancels stale gestures on %s changes', (change) => {
        const host = createMockEditor(createMockModel('one\n\ntwo'));
        const onCancel = vi.fn();
        const dispose = mdDraggerMonaco(host.editor, {
            ...options,
            locate: { sourceLineFromInput: () => 1 },
            ux: { modules: [{ name: 'test', onCancel }] },
        });
        pointer(host.domNode, 'pointerdown');
        pointer(host.win, 'pointermove');
        if (change === 'content') {
            host.native.getModel()?.setValue('changed');
            host.emitContent();
        } else host.setModel(null);
        expect(onCancel).toHaveBeenCalledOnce();
        pointer(host.win, 'pointermove');
        pointer(host.win, 'pointerup');
        expect(host.native.executeEdits).not.toHaveBeenCalled();
        dispose();
    });

    it('commits through the real runtime without cancelling its own model event', () => {
        const model = createMockModel('one\n\ntwo');
        const host = createMockEditor(model);
        const config = vi.fn(() => ({ tabSize: 4, listIndentUnit: 4 }));
        const onDragEnd = vi.fn();
        const onCancel = vi.fn();
        const dispose = mdDraggerMonaco(host.editor, {
            ...options,
            config,
            locate: {
                sourceLineFromInput: () => 1,
                resolveDropPosition: () => ({ doc: monacoDoc(model), line: 4, parent: null }),
            },
            ux: { modules: [{ name: 'test', onDragEnd, onCancel }] },
        });
        config.mockReturnValue({ tabSize: 4, listIndentUnit: 2 });
        config.mockClear();
        pointer(host.domNode, 'pointerdown');
        pointer(host.win, 'pointermove');
        pointer(host.win, 'pointerup');
        expect(model.getValue()).toBe('\ntwo\none');
        expect(onDragEnd).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ kind: 'applied' }));
        expect(onCancel).not.toHaveBeenCalled();
        expect(config).toHaveBeenCalled();
        dispose();
    });
});
