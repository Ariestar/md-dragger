import type { editor } from 'monaco-editor';
import type { Doc, DocLine } from '../../domain';

/**
 * Adapts Monaco's ITextModel to md-dragger's Doc interface.
 * Reads directly from the model without copying or caching.
 */
export function monacoDoc(model: editor.ITextModel): Doc {
    return {
        get lines(): number {
            return model.getLineCount();
        },
        get length(): number {
            return model.getValueLength();
        },
        line(n: number): DocLine {
            const count = model.getLineCount();
            if (n < 1 || n > count) {
                throw new RangeError(`Line number ${n} out of range 1..${count}`);
            }
            const text = model.getLineContent(n);
            const from = model.getOffsetAt({ lineNumber: n, column: 1 });
            return {
                from,
                to: from + text.length,
                text,
            };
        },
        lineAt(pos: number): { number: number } {
            const position = model.getPositionAt(pos);
            return { number: position.lineNumber };
        },
        sliceString(from: number, to: number): string {
            const len = model.getValueLength();
            const end = Math.min(to, len);
            if (from >= end) return '';
            const startPos = model.getPositionAt(from);
            const endPos = model.getPositionAt(end);
            return model.getValueInRange({
                startLineNumber: startPos.lineNumber,
                startColumn: startPos.column,
                endLineNumber: endPos.lineNumber,
                endColumn: endPos.column,
            });
        },
    };
}
