import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import { BlockType, type Block } from '../block/block-types';
import { detectBlock } from '../block/block-detector';
import type { DropPosition } from '../command/drop-position';
import { getLineMap, getLineMetaAt, listLineAtOrAbove, type LineMap } from './line-map';
import { computeListIntent } from './list-target';
import { isLineNumberInRanges } from './line-range';
import { selectionLineRanges } from '../selection/block-selection';

// Pointer metrics → DropPosition { doc, line, parent }.
// Parent resolution uses line-map O(1) listParentLine + detectBlock (cached).

export type DropLocateInput = {
    doc: Doc;
    selection: BlockSelection;
    hitLine: number;
    belowMid: boolean;
    pastMarker: boolean;
    markerOffset: (listLine: number) => number | null;
    tabSize: number;
    indentUnit: number;
};

/**
 * Resolve drop site: insert-before line + optional nest parent.
 * List child/sibling/outdent are gestures → parent null or a list item block.
 */
export function locateDropPosition(input: DropLocateInput): DropPosition | null {
    const {
        doc,
        selection,
        hitLine,
        belowMid,
        pastMarker,
        markerOffset,
        tabSize,
        indentUnit,
    } = input;

    if (hitLine < 1) {
        return { doc, line: 1, parent: null };
    }
    if (hitLine > doc.lines) {
        return { doc, line: doc.lines + 1, parent: null };
    }

    const lineMap = getLineMap(doc, { tabSize });
    const hitMeta = getLineMetaAt(lineMap, hitLine);
    let line = Math.max(1, Math.min(doc.lines + 1, belowMid ? hitLine + 1 : hitLine));

    const nestZone = !!hitMeta?.isList && pastMarker;
    if (nestZone && !belowMid) {
        line = Math.max(1, Math.min(doc.lines + 1, hitLine + 1));
    }

    // Nest under list item under the pointer (not self).
    if (nestZone) {
        const parent = detectBlock(doc, hitLine, { tabSize });
        if (parent?.type === BlockType.ListItem) {
            const sourceLines = selectionLineRanges(doc.lines, selection);
            if (!isLineNumberInRanges(hitLine, sourceLines)) {
                return { doc, line, parent };
            }
        }
    }

    const fromIntent = listParentFromIntent({
        doc,
        lineMap,
        selection,
        hitLine,
        targetLine: line,
        nestZone,
        markerOffset,
        indentUnit,
        tabSize,
    });
    if (fromIntent) return fromIntent;

    return { doc, line, parent: null };
}

function listParentFromIntent(params: {
    doc: Doc;
    lineMap: LineMap;
    selection: BlockSelection;
    hitLine: number;
    targetLine: number;
    nestZone: boolean;
    markerOffset: (listLine: number) => number | null;
    indentUnit: number;
    tabSize: number;
}): DropPosition | null {
    const {
        doc,
        lineMap,
        selection,
        hitLine,
        targetLine,
        nestZone,
        markerOffset,
        indentUnit,
        tabSize,
    } = params;

    const refLine = nestZone
        ? hitLine
        : listLineAtOrAbove(lineMap, targetLine - 1);
    if (refLine === null || refLine < 1) return null;

    const offset = markerOffset(refLine);
    if (offset === null) return null;

    const sourceLines = selectionLineRanges(doc.lines, selection);
    const self = isLineNumberInRanges(refLine, sourceLines);
    const intent = computeListIntent({
        doc,
        lineMap,
        refLine,
        offset,
        indentUnit,
        allowChild: !self,
    });
    if (!intent) return null;

    if (intent.mode === 'child') {
        // O(1) parent line via map, then detectBlock (cached by line).
        const parent = parentBlockAtListLine(doc, intent.contextLineNumber, tabSize);
        if (!parent) return null;
        return { doc, line: targetLine, parent };
    }

    // sibling | outdent → parent = list parent of context line (null = root)
    const parentLine = lineMap.listParentLine[intent.contextLineNumber] ?? 0;
    if (parentLine <= 0) {
        return { doc, line: targetLine, parent: null };
    }
    const parent = parentBlockAtListLine(doc, parentLine, tabSize);
    return { doc, line: targetLine, parent };
}

/**
 * List parent block at a list item head line.
 * Uses line-map parent links (O(1)) + detectBlock cache — no tree walk for index.
 */
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
    options: { tabSize: number; indentUnit: number }
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
