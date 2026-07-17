import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import { BlockType, type Block } from '../block/block-types';
import { detectBlock } from '../block/block-detector';
import type { DropPosition } from '../command/drop-position';
import { getLineMap, getLineMetaAt } from './line-map';
import { isLineNumberInRanges } from './line-range';
import { selectionLineRanges } from '../selection/block-selection';

/**
 * Drop locate — y only for structure (reuse detectBlock + line-map):
 *   hitLine + belowMid → insert-before seam line
 *   list row under pointer → parent = that list item (nest, any depth)
 *   seam between items   → parent = that item's list parent (sibling; null = root)
 *   non-list             → parent = null
 *
 * No pastMarker, no pixel columns, no dual intent paths.
 */

export type DropLocateInput = {
    doc: Doc;
    selection: BlockSelection;
    hitLine: number;
    belowMid: boolean;
    tabSize: number;
    indentUnit: number;
};

export function locateDropPosition(input: DropLocateInput): DropPosition | null {
    const { doc, selection, hitLine, belowMid, tabSize } = input;

    if (hitLine < 1) {
        return { doc, line: 1, parent: null };
    }
    if (hitLine > doc.lines) {
        return { doc, line: doc.lines + 1, parent: null };
    }

    const lineMap = getLineMap(doc, { tabSize });
    let line = Math.max(1, Math.min(doc.lines + 1, belowMid ? hitLine + 1 : hitLine));

    const hitMeta = getLineMetaAt(lineMap, hitLine);
    if (!hitMeta?.isList) {
        return { doc, line, parent: null };
    }

    const item = listItemAt(doc, hitLine, tabSize);
    if (!item) {
        return { doc, line, parent: null };
    }

    const sourceLines = selectionLineRanges(doc.lines, selection);
    const self = isLineNumberInRanges(hitLine, sourceLines);

    // Pointer on a list row: nest into that item (any depth), unless self.
    // Seam after the head (belowMid) still nests under the item when staying on its row zone;
    // sibling is "between items" — modeled as: belowMid on item → insert after head under same parent
    // of *next* structure is handled by line; for nest vs sibling we use:
    //   upper half of item row → nest under item
    //   lower half → sibling after item (parent = item's list parent)
    // So belowMid selects sibling; !belowMid selects nest. Reuses existing belowMid, no pastMarker.
    if (!belowMid && !self) {
        // Nest into item: insert after head line
        line = Math.max(1, Math.min(doc.lines + 1, hitLine + 1));
        return { doc, line, parent: item };
    }

    // Sibling of this list item (or self-row lower half / self)
    const parentLine = lineMap.listParentLine[hitLine] ?? 0;
    if (parentLine <= 0) {
        return { doc, line, parent: null };
    }
    const parent = listItemAt(doc, parentLine, tabSize);
    return { doc, line, parent };
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
export function dropIndentWidth(
    position: DropPosition,
    options: { tabSize: number; indentUnit: number },
): number {
    if (position.parent?.type === BlockType.ListItem) {
        const lineMap = getLineMap(position.doc, { tabSize: options.tabSize });
        const meta = getLineMetaAt(lineMap, position.parent.lines.startLine);
        const base = meta?.indentWidth ?? 0;
        return base + options.indentUnit;
    }
    return 0;
}

/** Marker style sample line: parent head, else line above seam. */
export function listSampleLine(position: DropPosition): number {
    if (position.parent) return position.parent.lines.startLine;
    return Math.max(1, position.line - 1);
}
