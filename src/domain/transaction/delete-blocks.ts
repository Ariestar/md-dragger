import type { Doc } from '../markdown/document-types';
import { type Reject, reject } from '../result';
import { type BlockSelection, selectionLineRanges } from '../selection/block-selection';
import type { DocEdit, TextChange } from './block-transaction';

export function planDelete(params: { doc: Doc; selection: BlockSelection }): DocEdit | Reject {
    const { doc, selection } = params;
    const ranges = selectionLineRanges(doc.lines, selection);
    if (ranges.length === 0) return reject('empty_selection');

    const changes: TextChange[] = ranges
        .map((range) => {
            const startLine = doc.line(range.startLine);
            const endLine = doc.line(range.endLine);
            const deletesOnlyFinalLine =
                range.startLine === range.endLine && range.endLine === doc.lines && range.startLine > 1;
            return {
                from: deletesOnlyFinalLine ? startLine.from - 1 : startLine.from,
                to: range.endLine === doc.lines ? doc.length : Math.min(doc.length, endLine.to + 1),
                insert: '',
            };
        })
        .filter((change) => change.to > change.from)
        .sort((a, b) => b.from - a.from);

    if (changes.length === 0) return reject('empty_selection');
    return { doc, changes };
}
