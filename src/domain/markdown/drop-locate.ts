import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import { BlockType, type Block } from '../block/block-types';
import { detectBlock } from '../block/block-detector';
import type { DropPosition } from '../command/drop-position';
import { getLineMap, getLineMetaAt, getNearestListLineAtOrBefore, type LineMap } from './line-map';
import { computeListIntent } from './list-target';
import { isLineNumberInRanges } from './line-range';
import { selectionLineRanges } from '../selection/block-selection';

// Pointer metrics → structural DropPosition { parent, index, line }.

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
 * Resolve drop as a tree site (parent + index) + insert-before line.
 * List child / sibling / outdent are locate gestures; result is only parent+index.
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
        return rootPosition(doc, 1, 0);
    }
    if (hitLine > doc.lines) {
        return rootPosition(doc, doc.lines + 1, estimateRootIndex(doc, doc.lines + 1, tabSize));
    }

    const lineMap = getLineMap(doc, { tabSize });
    const hitMeta = getLineMetaAt(lineMap, hitLine);
    let line = Math.max(1, Math.min(doc.lines + 1, belowMid ? hitLine + 1 : hitLine));

    const nestZone = !!hitMeta?.isList && pastMarker;
    if (nestZone && !belowMid) {
        line = Math.max(1, Math.min(doc.lines + 1, hitLine + 1));
    }

    // Explicit nest under the list item under the pointer (not self).
    if (nestZone) {
        const parent = detectBlock(doc, hitLine, { tabSize });
        if (parent && parent.type === BlockType.ListItem) {
            const sourceLines = selectionLineRanges(doc.lines, selection);
            if (!isLineNumberInRanges(hitLine, sourceLines)) {
                return {
                    doc,
                    parent,
                    index: childIndexUnderParent(doc, parent, line, tabSize),
                    line,
                };
            }
        }
    }

    const fromIntent = listTreePositionFromIntent({
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

    return rootPosition(doc, line, estimateRootIndex(doc, line, tabSize));
}

function listTreePositionFromIntent(params: {
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
        : getNearestListLineAtOrBefore(lineMap, targetLine - 1);
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
        const parent = detectBlock(doc, intent.contextLineNumber, { tabSize });
        if (!parent || parent.type !== BlockType.ListItem) return null;
        return {
            doc,
            parent,
            index: childIndexUnderParent(doc, parent, targetLine, tabSize),
            line: targetLine,
        };
    }

    // sibling | outdent → parent = list parent of context (null = document root)
    const contextLine = intent.contextLineNumber;
    const parentLine = lineMap.listParentLine[contextLine] ?? 0;
    const parent = parentLine > 0
        ? detectBlock(doc, parentLine, { tabSize })
        : null;
    if (parentLine > 0 && (!parent || parent.type !== BlockType.ListItem)) {
        return rootPosition(doc, targetLine, estimateRootIndex(doc, targetLine, tabSize));
    }

    return {
        doc,
        parent: parentLine > 0 ? parent : null,
        index: parent
            ? childIndexUnderParent(doc, parent, targetLine, tabSize)
            : estimateRootIndex(doc, targetLine, tabSize),
        line: targetLine,
    };
}

function rootPosition(doc: Doc, line: number, index: number): DropPosition {
    return { doc, parent: null, index, line };
}

/** Child index under a list parent: count sibling list items starting before `line`. */
function childIndexUnderParent(
    doc: Doc,
    parent: Block,
    line: number,
    tabSize: number,
): number {
    const lineMap = getLineMap(doc, { tabSize });
    const parentStart = parent.lines.startLine;
    const parentEnd = Math.min(
        parent.lines.endLine,
        lineMap.listSubtreeEndLine[parentStart] || parent.lines.endLine,
    );
    let index = 0;
    for (let n = parentStart + 1; n < line && n <= parentEnd; n++) {
        const meta = getLineMetaAt(lineMap, n);
        if (!meta?.isList) continue;
        if ((lineMap.listParentLine[n] ?? 0) === parentStart) {
            index += 1;
        }
    }
    return index;
}

/** Approximate root-level block index for insert-before `line`. */
function estimateRootIndex(doc: Doc, line: number, tabSize: number): number {
    let index = 0;
    let n = 1;
    while (n < line && n <= doc.lines) {
        const block = detectBlock(doc, n, { tabSize });
        if (!block) {
            n += 1;
            continue;
        }
        // only count top-level-ish: list items at indent 0, or non-list blocks
        const lineMap = getLineMap(doc, { tabSize });
        const meta = getLineMetaAt(lineMap, block.lines.startLine);
        const isNestedList = block.type === BlockType.ListItem
            && (meta?.indentWidth ?? 0) > 0;
        if (!isNestedList) {
            index += 1;
        }
        n = block.lines.endLine + 1;
    }
    return index;
}

/**
 * Indent columns for paint/compile.
 * Derived only from tree parent — never from "nearest line" heuristics.
 * - under list parent → parentIndent + indentUnit
 * - document root → 0
 */
export function dropIndentWidth(
    position: DropPosition,
    options: { tabSize: number; indentUnit: number }
): number {
    if (position.parent && position.parent.type === BlockType.ListItem) {
        const lineMap = getLineMap(position.doc, { tabSize: options.tabSize });
        const meta = getLineMetaAt(lineMap, position.parent.lines.startLine);
        const base = meta?.indentWidth ?? 0;
        return base + options.indentUnit;
    }
    return 0;
}

/** Context line for list marker style sampling. */
export function dropContextLine(position: DropPosition): number {
    if (position.parent) return position.parent.lines.startLine;
    return Math.max(1, position.line - 1);
}
