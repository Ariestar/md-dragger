import { detectBlock } from '../block/block-detector';
import { type Block, BlockType } from '../block/block-types';
import type { DropPosition } from '../command/drop-position';
import type { BlockSelection } from '../selection/block-selection';
import { selectionLineRanges } from '../selection/block-selection';
import type { Doc } from './document-types';
import { getLineMap, getLineMetaAt, listLineAtOrAbove } from './line-map';
import { isLineNumberInRanges } from './line-range';

/**
 * Drop locate — two independent axes, no cross-null:
 *   y → insert-before seam line (always)
 *   x → target indent → parent at that seam (clamp to structure, never kills y)
 */
export type DropLocateInput = {
    doc: Doc;
    selection: BlockSelection;
    hitLine: number;
    belowMid: boolean;
    sourceIndentWidth: number;
    targetIndentWidth: number;
    tabSize: number;
    indentUnit: number;
};

export function locateDropPosition(input: DropLocateInput): DropPosition {
    const { doc, selection, hitLine, belowMid, sourceIndentWidth, targetIndentWidth, tabSize, indentUnit } = input;

    const line = Math.max(1, Math.min(doc.lines + 1, belowMid ? hitLine + 1 : hitLine));

    // x cannot veto y: root seam is always valid.
    if (indentUnit <= 0 || line <= 1) {
        return { doc, line, parent: null };
    }

    // One drop may nest freely, but can outdent by at most one level.
    const want = Math.max(
        quantizeIndent(targetIndentWidth, indentUnit),
        quantizeIndent(sourceIndentWidth, indentUnit) - indentUnit,
    );
    if (want <= 0) {
        return { doc, line, parent: null };
    }

    const lineMap = getLineMap(doc, { tabSize });
    const above = line - 1;
    let parentLine = listLineAtOrAbove(lineMap, above);
    if (parentLine === null || lineMap.listSubtreeEndLine[parentLine] < above) {
        return { doc, line, parent: null };
    }

    // Child indent `want` needs parent indent `want - unit`.
    // Walk up until indent ≤ desired; skip self-selection.
    const desiredParentIndent = want - indentUnit;
    const sourceLines = selectionLineRanges(doc.lines, selection);

    while (parentLine > 0) {
        const meta = getLineMetaAt(lineMap, parentLine);
        if (!meta?.isList) {
            parentLine = 0;
            break;
        }
        if (isLineNumberInRanges(parentLine, sourceLines)) {
            parentLine = lineMap.listParentLine[parentLine] ?? 0;
            continue;
        }
        if (meta.indentWidth > desiredParentIndent) {
            parentLine = lineMap.listParentLine[parentLine] ?? 0;
            continue;
        }
        break;
    }

    if (parentLine <= 0) {
        return { doc, line, parent: null };
    }

    const parent = listItemAt(doc, parentLine, tabSize);
    return { doc, line, parent };
}

function quantizeIndent(width: number, indentUnit: number): number {
    if (!(width > 0) || !(indentUnit > 0)) return 0;
    return Math.max(0, Math.round(width / indentUnit) * indentUnit);
}

function listItemAt(doc: Doc, listHeadLine: number, tabSize: number): Block | null {
    const block = detectBlock(doc, listHeadLine, { tabSize });
    if (!block || block.type !== BlockType.ListItem) return null;
    return block;
}

/**
 * Indent for paint/compile from parent only.
 * root → 0; under list item → parentIndent + unit.
 */
export function dropIndentWidth(position: DropPosition, options: { tabSize: number; indentUnit: number }): number {
    if (position.parent?.type === BlockType.ListItem) {
        const lineMap = getLineMap(position.doc, { tabSize: options.tabSize });
        const meta = getLineMetaAt(lineMap, position.parent.lines.startLine);
        const base = meta?.indentWidth ?? 0;
        return base + options.indentUnit;
    }
    return 0;
}
