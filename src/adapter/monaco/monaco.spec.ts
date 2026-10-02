import type { editor } from 'monaco-editor';
import { describe, expect, it, vi } from 'vitest';
import { applyCommit } from './commit';
import { type MdDraggerMonacoOptions, resolveConfig, resolveListIndentUnit } from './config';
import { monacoDoc } from './doc';
import { mdDraggerMonaco } from './index';
import { DropSeamWidget } from './widget';

function createMockModel(content: string): editor.ITextModel {
    const lines = content.split('\n');
    const offsets: number[] = [];
    let current = 0;
    for (const line of lines) {
        offsets.push(current);
        current += line.length + 1; // +1 for \n
    }

    return {
        getLineCount: () => lines.length,
        getLineContent: (n: number) => lines[n - 1],
        getOffsetAt: ({ lineNumber }: { lineNumber: number }) => offsets[lineNumber - 1],
        getValueLength: () => content.length,
        getPositionAt: (offset: number) => {
            let lineIdx = 0;
            while (lineIdx < offsets.length - 1 && offsets[lineIdx + 1] <= offset) {
                lineIdx++;
            }
            return {
                lineNumber: lineIdx + 1,
                column: offset - offsets[lineIdx] + 1,
            };
        },
        getValueInRange: (range: {
            startLineNumber: number;
            startColumn: number;
            endLineNumber: number;
            endColumn: number;
        }) => {
            // simplified range value
            return content.slice(
                offsets[range.startLineNumber - 1] + range.startColumn - 1,
                offsets[range.endLineNumber - 1] + range.endColumn - 1,
            );
        },
        getOptions: () => ({ tabSize: 4 }) as editor.TextModelResolvedOptions,
    } as unknown as editor.ITextModel;
}

describe('adapter/monaco doc', () => {
    it('adapts ITextModel to Doc interface', () => {
        const model = createMockModel('# Heading\nParagraph line\n- list item');
        const doc = monacoDoc(model);

        expect(doc.lines).toBe(3);
        expect(doc.line(1).text).toBe('# Heading');
        expect(doc.line(1).from).toBe(0);
        expect(doc.line(2).text).toBe('Paragraph line');
        expect(doc.line(3).text).toBe('- list item');

        expect(doc.sliceString(0, 9)).toBe('# Heading');
        expect(doc.sliceString(10, 24)).toBe('Paragraph line');
    });

    it('throws RangeError on out-of-bounds line query', () => {
        const model = createMockModel('one line');
        const doc = monacoDoc(model);

        expect(() => doc.line(0)).toThrow(RangeError);
        expect(() => doc.line(2)).toThrow(RangeError);
    });
});

describe('adapter/monaco commit', () => {
    it('applies DocEdit transactions via executeEdits', () => {
        const model = createMockModel('hello world');
        const executeEdits = vi.fn();
        const editor = {
            getModel: () => model,
            executeEdits,
        } as unknown as editor.ICodeEditor;

        const doc = monacoDoc(model);
        applyCommit(editor, [
            {
                doc,
                changes: [{ from: 6, to: 11, insert: 'monaco' }],
            },
        ]);

        expect(executeEdits).toHaveBeenCalledTimes(1);
        expect(executeEdits).toHaveBeenCalledWith('md-dragger', [
            {
                range: {
                    startLineNumber: 1,
                    startColumn: 7,
                    endLineNumber: 1,
                    endColumn: 12,
                },
                text: 'monaco',
                forceMoveMarkers: true,
            },
        ]);
    });
});

describe('adapter/monaco config', () => {
    it('resolves valid config', () => {
        const options: MdDraggerMonacoOptions = {
            config: { tabSize: 4, listIndentUnit: 2 },
            listIndentWidthPx: 20,
        };
        expect(resolveConfig(options.config)).toEqual({ tabSize: 4, listIndentUnit: 2 });
        expect(resolveListIndentUnit(options)).toBe(2);
    });

    it('throws on non-positive tabSize or listIndentUnit', () => {
        expect(() => resolveConfig({ tabSize: 0, listIndentUnit: 4 })).toThrow();
        expect(() => resolveConfig({ tabSize: 4, listIndentUnit: 0 })).toThrow();
    });
});

describe('adapter/monaco lifecycle', () => {
    it('mounts overlay widget and cleans up on dispose', () => {
        const model = createMockModel('text');
        const addOverlayWidget = vi.fn();
        const removeOverlayWidget = vi.fn();
        const domNode = Object.assign(new EventTarget(), {
            ownerDocument: {
                createElement: () => ({
                    style: {},
                    classList: { add: vi.fn(), remove: vi.fn() },
                    remove: vi.fn(),
                }),
                defaultView: new EventTarget(),
            },
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
        });

        const editor = {
            getModel: () => model,
            getDomNode: () => domNode,
            addOverlayWidget,
            removeOverlayWidget,
            deltaDecorations: vi.fn().mockReturnValue([]),
            getLayoutInfo: () => ({ contentLeft: 30, contentWidth: 500 }),
            getOption: () => 19,
            getScrollTop: () => 0,
            getTopForLineNumber: () => 0,
            getTargetAtClientPoint: () => null,
        } as unknown as editor.ICodeEditor;

        const options: MdDraggerMonacoOptions = {
            config: { tabSize: 4, listIndentUnit: 4 },
            listIndentWidthPx: 24,
        };

        const dispose = mdDraggerMonaco(editor, options);
        expect(addOverlayWidget).toHaveBeenCalledTimes(1);
        expect(addOverlayWidget).toHaveBeenCalledWith(expect.any(DropSeamWidget));

        dispose();
        expect(removeOverlayWidget).toHaveBeenCalledTimes(1);
    });
});
