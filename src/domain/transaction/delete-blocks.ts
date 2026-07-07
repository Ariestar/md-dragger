import type { DocLikeWithRange } from '../markdown/document-types';
import { normalizeCompositeRanges } from '../selection/selection-ranges';
import type { BlockSelection } from '../selection/block-selection';
import type { BlockTransaction, TextChange } from './block-transaction';
import { rejectCommand, type CommandReject } from './command-reject';

export function planDeleteBlocksTransaction(params: {
    doc: DocLikeWithRange;
    selection: BlockSelection;
}): BlockTransaction | CommandReject {
    const { doc, selection } = params;
    const ranges = normalizeCompositeRanges(selection.ranges, doc.lines);
    if (ranges.length === 0) return rejectCommand('empty_selection');

    const changes: TextChange[] = ranges
        .map((range) => {
            const startLineNumber = range.startLine + 1;
            const endLineNumber = range.endLine + 1;
            const startLine = doc.line(startLineNumber);
            const endLine = doc.line(endLineNumber);
            const deletesOnlyFinalLine = startLineNumber === endLineNumber
                && endLineNumber === doc.lines
                && startLineNumber > 1;
            return {
                from: deletesOnlyFinalLine ? startLine.from - 1 : startLine.from,
                to: endLineNumber === doc.lines
                    ? doc.length
                    : Math.min(doc.length, endLine.to + 1),
                insert: '',
            };
        })
        .filter((change) => change.to > change.from)
        .sort((a, b) => b.from - a.from);

    if (changes.length === 0) return rejectCommand('empty_selection');
    return { changes };
}
