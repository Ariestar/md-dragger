import type { Doc } from '../markdown/document-types';
import { getLineMap } from '../markdown/line-map';
import { removalCreatesFrontmatter } from '../move/move-plan';
import { removeSegment } from '../mutation';
import { type Reject, reject } from '../result';
import { type BlockSelection, selectionSegments } from '../selection/block-selection';
import type { DocEdit } from './block-transaction';

export function planDelete(params: { doc: Doc; selection: BlockSelection; tabSize: number }): DocEdit | Reject {
    const { doc, selection, tabSize } = params;
    const lineMap = getLineMap(doc, { tabSize });
    const { blocks, segments } = selectionSegments(selection, { lineMap });
    if (segments.length === 0) return reject('empty_selection');
    if (removalCreatesFrontmatter(doc, lineMap, segments)) return reject('frontmatter_fence');

    const changes = segments
        .map((segment) => removeSegment(doc, segment, { lineMap, tabSize, renumbers: false, blocks }))
        .filter((change) => change.to > change.from)
        .sort((a, b) => b.from - a.from);

    if (changes.length === 0) return reject('empty_selection');
    return { doc, changes };
}
