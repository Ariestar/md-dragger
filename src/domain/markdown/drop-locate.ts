import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import { BlockType, type Block } from '../block/block-types';
import { detectBlock } from '../block/block-detector';
import type { DropPosition } from '../command/drop-position';
import { getLineMap, getLineMetaAt, getNearestListLineAtOrBefore, type LineMap } from './line-map';
import { computeListIntent } from './list-target';
import { isLineNumberInRanges } from './line-range';
import { selectionLineRanges } from '../selection/block-selection';

// Pointer metrics → structural DropPosition. No paint fields.

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
 * Resolve where a drop lands structurally.
 * Nest (inside) is driven by hit geometry on the target, not selection primary.
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
        return { kind: 'seam', doc, line: 1 };
    }
    if (hitLine > doc.lines) {
        return { kind: 'seam', doc, line: doc.lines + 1 };
    }

    const lineMap = getLineMap(doc, { tabSize });
    const hitMeta = getLineMetaAt(lineMap, hitLine);

    let line = Math.max(1, Math.min(doc.lines + 1, belowMid ? hitLine + 1 : hitLine));

    const nestZone = !!hitMeta?.isList && pastMarker;
    if (nestZone && !belowMid) {
        line = Math.max(1, Math.min(doc.lines + 1, hitLine + 1));
    }

    if (nestZone) {
        const parent = detectBlock(doc, hitLine, { tabSize });
        if (parent && parent.type === BlockType.ListItem) {
            const sourceLines = selectionLineRanges(doc.lines, selection);
            const selfHit = isLineNumberInRanges(hitLine, sourceLines);
            if (!selfHit) {
                return { kind: 'inside', doc, parent, line };
            }
            // Self: still allow indent slots via list intent geometry → seam with line
        }
    }

    // Optional: list column snap only adjusts seam line / future projection; structure stays seam
    // unless computeListIntent says child toward a non-self ref.
    const listPos = listInsideIfChild({
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
    if (listPos) return listPos;

    return { kind: 'seam', doc, line };
}

function listInsideIfChild(params: {
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
    if (!intent || intent.mode !== 'child') return null;

    const parent = detectBlock(doc, intent.contextLineNumber, { tabSize });
    if (!parent || parent.type !== BlockType.ListItem) return null;

    return {
        kind: 'inside',
        doc,
        parent,
        line: targetLine,
    };
}

/** Indent columns for paint/compile from a position (derived, not stored on DropPosition). */
export function dropIndentWidth(
    position: DropPosition,
    options: { tabSize: number; indentUnit: number }
): number {
    if (position.kind === 'inside' && position.parent.type === BlockType.ListItem) {
        const lineMap = getLineMap(position.doc, { tabSize: options.tabSize });
        const meta = getLineMetaAt(lineMap, position.parent.lines.startLine);
        const base = meta?.indentWidth ?? 0;
        return base + options.indentUnit;
    }
    const lineMap = getLineMap(position.doc, { tabSize: options.tabSize });
    const near = getNearestListLineAtOrBefore(lineMap, position.line - 1);
    if (near === null) return 0;
    return getLineMetaAt(lineMap, near)?.indentWidth ?? 0;
}
