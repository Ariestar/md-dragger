import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import { BlockType, type Block } from '../block/block-types';
import { detectBlock } from '../block/block-detector';
import type { DropPosition } from '../command/drop-position';
import { getLineMap, getLineMetaAt } from './line-map';
import { isLineNumberInRanges } from './line-range';
import { selectionLineRanges } from '../selection/block-selection';

/**
 * Drop locate — one simple model:
 *   y → which line (insert-before seam)
 *   x → on a list row: past marker = nest into that item;
 *                      otherwise = sibling of that item
 *   non-list row → top-level seam (parent null)
 *
 * No pixel columns, no dual nestZone/intent paths, no silent outdent-to-root snap.
 */

export type DropLocateInput = {
    doc: Doc;
    selection: BlockSelection;
    hitLine: number;
    belowMid: boolean;
    /** Pointer x is past the list marker of hitLine (content / nest zone). */
    pastMarker: boolean;
    tabSize: number;
    indentUnit: number;
};

export function locateDropPosition(input: DropLocateInput): DropPosition | null {
    const { doc, selection, hitLine, belowMid, pastMarker, tabSize } = input;

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

    const sourceLines = selectionLineRanges(doc.lines, selection);
    const self = isLineNumberInRanges(hitLine, sourceLines);

    // Nest into the list item under the pointer (any depth).
    if (pastMarker && !self) {
        const parent = listItemAt(doc, hitLine, tabSize);
        if (parent) {
            if (!belowMid) {
                line = Math.max(1, Math.min(doc.lines + 1, hitLine + 1));
            }
            return { doc, line, parent };
        }
    }

    // Sibling of the list item under the pointer:
    // parent = that item's list parent (null = top-level list).
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
