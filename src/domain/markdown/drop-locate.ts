import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import { BlockType, type Block } from '../block/block-types';
import { detectBlock } from '../block/block-detector';
import type { DropPosition } from '../command/drop-position';
import { getLineMap, getLineMetaAt, listLineAtOrAbove, type LineMap } from './line-map';
import { computeListIntent } from './list-target';
import { isLineNumberInRanges } from './line-range';
import { selectionLineRanges } from '../selection/block-selection';

/**
 * Drop locate — one path only:
 *   y → insert-before line (seam)
 *   x → absolute indent column → snap to structure → parent
 *
 * No separate nestZone branch. pastMarker only raises the floor column
 * (at least one nest step under the hit list item).
 */

export type DropLocateInput = {
    doc: Doc;
    selection: BlockSelection;
    hitLine: number;
    belowMid: boolean;
    /**
     * True when the pointer is past the list marker of hitLine (content zone).
     * Used only to floor column ≥ hitIndent + indentUnit — not a second resolve path.
     */
    pastMarker: boolean;
    /**
     * Absolute indent-width column of the pointer on a list line
     * (same units as parseLine indent.width / LineMeta.indentWidth).
     */
    pointerColumn: (listLine: number) => number | null;
    tabSize: number;
    indentUnit: number;
};

export function locateDropPosition(input: DropLocateInput): DropPosition | null {
    const {
        doc,
        selection,
        hitLine,
        belowMid,
        pastMarker,
        pointerColumn,
        tabSize,
        indentUnit,
    } = input;

    // --- y: seam line ---
    if (hitLine < 1) {
        return { doc, line: 1, parent: null };
    }
    if (hitLine > doc.lines) {
        return { doc, line: doc.lines + 1, parent: null };
    }

    const lineMap = getLineMap(doc, { tabSize });
    let line = Math.max(1, Math.min(doc.lines + 1, belowMid ? hitLine + 1 : hitLine));

    // --- list structure from x (column), single path ---
    const hitMeta = getLineMetaAt(lineMap, hitLine);
    const hitIsList = !!hitMeta?.isList;

    // Reference list line for indent structure
    let refLine = hitIsList
        ? hitLine
        : listLineAtOrAbove(lineMap, line - 1);

    if (refLine === null || refLine < 1) {
        // No list nearby: plain top-level seam
        return { doc, line, parent: null };
    }

    let column = pointerColumn(refLine);
    if (column === null) {
        // Cannot measure x → no silent root. Fail locate.
        return null;
    }

    // Content zone on a list row: floor column to at least child-of-hit
    if (hitIsList && pastMarker && indentUnit > 0) {
        const hitIndent = hitMeta?.indentWidth ?? 0;
        const childFloor = hitIndent + indentUnit;
        if (column < childFloor) column = childFloor;
        refLine = hitLine;
    }

    const sourceLines = selectionLineRanges(doc.lines, selection);
    const self = isLineNumberInRanges(refLine, sourceLines);

    const intent = computeListIntent({
        doc,
        lineMap,
        refLine,
        column,
        indentUnit,
        allowChild: !self,
    });
    if (!intent) {
        return null;
    }

    // When nesting under hit content, prefer insert-after-head seam
    if (intent.mode === 'child' && hitIsList && pastMarker && !belowMid) {
        line = Math.max(1, Math.min(doc.lines + 1, hitLine + 1));
    }

    return positionFromIntent(doc, lineMap, intent, line, tabSize);
}

function positionFromIntent(
    doc: Doc,
    lineMap: LineMap,
    intent: { mode: string; contextLineNumber: number; targetIndentWidth: number },
    targetLine: number,
    tabSize: number,
): DropPosition {
    if (intent.mode === 'child') {
        const parent = parentBlockAtListLine(doc, intent.contextLineNumber, tabSize);
        if (!parent) {
            // Structure says child but block missing — no silent root
            return { doc, line: targetLine, parent: null };
        }
        return { doc, line: targetLine, parent };
    }

    // sibling | outdent: parent = list parent of the context list line
    const parentLine = lineMap.listParentLine[intent.contextLineNumber] ?? 0;
    if (parentLine <= 0) {
        return { doc, line: targetLine, parent: null };
    }
    const parent = parentBlockAtListLine(doc, parentLine, tabSize);
    return { doc, line: targetLine, parent };
}

function parentBlockAtListLine(doc: Doc, listHeadLine: number, tabSize: number): Block | null {
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
