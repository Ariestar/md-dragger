import type { Doc } from './document-types';
import type { LineMap } from './line-map';
import { getLineMetaAt, getNearestListLineAtOrBefore } from './line-map';

// List drop-intent resolution — pure document/column-space logic.
//
// No DOM, no CodeMirror, no pixel coordinates from the host. The adapter
// layer translates pointer pixels into `cursorOffsetColumns` (how many
// columns the cursor sits from the list marker) and `indentUnit` (columns
// per indent step); this module then decides child / sibling / outdent by
// projecting candidate slots in column space and picking the nearest.

export type ListIntentMode = 'child' | 'sibling' | 'outdent';

export type ListIntent = {
    mode: ListIntentMode;
    contextLineNumber: number;
    targetIndentWidth: number;
};

export type ComputeListIntentParams = {
    doc: Doc;
    lineMap: LineMap;
    referenceLineNumber: number;
    /** Cursor position in columns relative to the reference line's marker start. */
    cursorOffsetColumns: number;
    /** Columns per indent step (from getIndentUnitWidthForDoc / column pixels). */
    indentUnit: number;
    allowChild: boolean;
};

// Decide list intent by nearest-slot projection.
//
// Slots (all in columns relative to the reference marker):
//   - same:    offset 0,                 indent = baseIndent,        mode sibling
//   - child:   offset +indentUnit,       indent = baseIndent + unit, mode child   (if allowChild)
//   - ancestor offsets (baseIndent - ancestorIndent) to the left, each mode outdent,
//     pointing at the ancestor line with the ancestor's indent.
//
// Returns null if the reference line isn't a list item.
export function computeListIntent(params: ComputeListIntentParams): ListIntent | null {
    const { doc, lineMap, referenceLineNumber, cursorOffsetColumns, indentUnit, allowChild } = params;
    if (referenceLineNumber < 1 || referenceLineNumber > doc.lines) return null;

    const baseIndent = listIndentWidthAtLine(lineMap, referenceLineNumber);
    if (baseIndent === undefined) return null;

    type Slot = { offset: number; line: number; indent: number; mode: ListIntentMode };
    const slots: Slot[] = [];

    slots.push({ offset: 0, line: referenceLineNumber, indent: baseIndent, mode: 'sibling' });

    if (allowChild) {
        const childIndent = baseIndent + indentUnit;
        slots.push({ offset: indentUnit, line: referenceLineNumber, indent: childIndent, mode: 'child' });
    }

    for (const ancestorLine of getListAncestorLineNumbers(doc, referenceLineNumber, lineMap)) {
        if (ancestorLine === referenceLineNumber) continue;
        const ancestorIndent = listIndentWidthAtLine(lineMap, ancestorLine);
        if (ancestorIndent === undefined || ancestorIndent >= baseIndent) continue;
        const offset = -(baseIndent - ancestorIndent);
        slots.push({ offset, line: ancestorLine, indent: ancestorIndent, mode: 'outdent' });
    }

    let best = slots[0];
    let bestDist = Math.abs(cursorOffsetColumns - best.offset);
    for (let i = 1; i < slots.length; i++) {
        const dist = Math.abs(cursorOffsetColumns - slots[i].offset);
        if (dist < bestDist) {
            best = slots[i];
            bestDist = dist;
        }
    }

    return {
        mode: best.mode,
        contextLineNumber: best.line,
        targetIndentWidth: best.indent,
    };
}

// Find the list subtree root at or above `lineNumber` (the reference line for
// intent resolution). Walks listSubtreeEndLine up via listParentLine.
export function resolveReferenceListLineNumber(lineNumber: number, lineMap: LineMap): number | null {
    const nearestListLine = getNearestListLineAtOrBefore(lineMap, lineNumber);
    if (nearestListLine === null) return null;
    let cursor = nearestListLine;
    while (cursor > 0) {
        const subtreeEnd = lineMap.listSubtreeEndLine[cursor];
        if (subtreeEnd >= lineNumber) {
            return cursor;
        }
        cursor = lineMap.listParentLine[cursor];
    }
    return null;
}

// Ancestor list lines above `lineNumber` (the chain of enclosing list items).
export function getListAncestorLineNumbers(doc: Doc, lineNumber: number, lineMap: LineMap): number[] {
    const result: number[] = [];
    const clamped = Math.max(1, Math.min(lineNumber, doc.lines));
    let cursor = resolveReferenceListLineNumber(clamped, lineMap);
    while (cursor !== null && cursor > 0) {
        result.push(cursor);
        const parent = lineMap.listParentLine[cursor];
        cursor = parent > 0 ? parent : null;
    }
    return result;
}

// Find the nearest ancestor list line whose indent equals `targetIndent`.
// Used to locate the highlight/anchor line for an outdent target.
export function findParentLineNumberByIndent(
    doc: Doc,
    startLineNumber: number,
    targetIndent: number,
    lineMap: LineMap
): number | null {
    const clamped = Math.max(1, Math.min(startLineNumber, doc.lines));
    let cursor = resolveReferenceListLineNumber(clamped, lineMap);
    while (cursor !== null && cursor > 0) {
        const indent = listIndentWidthAtLine(lineMap, cursor);
        if (indent === targetIndent) return cursor;
        if (indent !== undefined && indent < targetIndent) break;
        const parent = lineMap.listParentLine[cursor];
        cursor = parent > 0 ? parent : null;
    }
    return null;
}

function listIndentWidthAtLine(lineMap: LineMap, lineNumber: number): number | undefined {
    const meta = getLineMetaAt(lineMap, lineNumber);
    if (!meta || !meta.isList) return undefined;
    return meta.indentWidth;
}
