import type { editor } from 'monaco-editor';
import type { Doc, DocLine } from '../../domain';
import { stringDoc } from '../../domain/transaction/string-doc';

const snapshots = new WeakMap<editor.ITextModel, { version: number; doc: Doc }>();

/**
 * Adapts Monaco's ITextModel to md-dragger's Doc interface.
 * Keeps a stable, immutable snapshot for each model version.
 */
export function monacoDoc(model: editor.ITextModel): Doc {
    const version = model.getVersionId();
    const cached = snapshots.get(model);
    if (cached?.version === version) return cached.doc;
    const text = stringDoc(model.getValue());
    const lines: DocLine[] = Array.from({ length: model.getLineCount() }, (_, index) => {
        const content = model.getLineContent(index + 1);
        const from = model.getOffsetAt({ lineNumber: index + 1, column: 1 });
        return { from, to: from + content.length, text: content };
    });
    const doc: Doc = {
        ...text,
        line(n: number): DocLine {
            if (!Number.isInteger(n) || n < 1 || n > lines.length) {
                throw new RangeError(`Line number ${n} out of range 1..${lines.length}`);
            }
            return lines[n - 1];
        },
    };
    snapshots.set(model, { version, doc });
    return doc;
}
