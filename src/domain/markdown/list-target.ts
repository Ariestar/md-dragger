import type { Doc } from './document-types';
import type { LineMap } from './line-map';
import { getLineMetaAt, listLineAtOrAbove } from './line-map';

// List drop intent — absolute indent columns only (no pixel math).
// Adapter supplies the pointer's column on a list line; domain snaps to
// sibling / child / ancestor indent slots.

export type ListIntentMode = 'child' | 'sibling' | 'outdent';

export type ListIntent = {
    mode: ListIntentMode;
    contextLineNumber: number;
    targetIndentWidth: number;
};

export type ComputeListIntentParams = {
    doc: Doc;
    lineMap: LineMap;
    /** List line used as structure baseline. */
    refLine: number;
    /**
     * Absolute indent width (columns) under the pointer on that line,
     * same units as LineMeta.indentWidth / parseLine indent.width.
     */
    column: number;
    indentUnit: number;
    allowChild: boolean;
};

/**
 * Snap `column` to the nearest structural indent:
 *   sibling  = ref indent
 *   child    = ref indent + unit
 *   outdent  = each ancestor's indent
 */
export function computeListIntent(params: ComputeListIntentParams): ListIntent | null {
    const { doc, lineMap, refLine, column, indentUnit, allowChild } = params;
    if (refLine < 1 || refLine > doc.lines) return null;

    const baseIndent = listIndent(lineMap, refLine);
    if (baseIndent === undefined) return null;

    type Slot = { indent: number; line: number; mode: ListIntentMode };
    const slots: Slot[] = [
        { indent: baseIndent, line: refLine, mode: 'sibling' },
    ];

    if (allowChild && indentUnit > 0) {
        slots.push({
            indent: baseIndent + indentUnit,
            line: refLine,
            mode: 'child',
        });
    }

    for (const ancestor of listAncestors(doc, refLine, lineMap)) {
        if (ancestor === refLine) continue;
        const ancestorIndent = listIndent(lineMap, ancestor);
        if (ancestorIndent === undefined || ancestorIndent >= baseIndent) continue;
        slots.push({
            indent: ancestorIndent,
            line: ancestor,
            mode: 'outdent',
        });
    }

    // Root outdent
    if (baseIndent > 0) {
        const hasRoot = slots.some((s) => s.indent === 0);
        if (!hasRoot) {
            slots.push({ indent: 0, line: refLine, mode: 'outdent' });
        }
    }

    let best = slots[0];
    let bestDist = Math.abs(column - best.indent);
    for (let i = 1; i < slots.length; i++) {
        const dist = Math.abs(column - slots[i].indent);
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

export function listAncestors(doc: Doc, line: number, lineMap: LineMap): number[] {
    const result: number[] = [];
    const clamped = Math.max(1, Math.min(line, doc.lines));
    let cursor = subtreeRoot(clamped, lineMap);
    while (cursor !== null && cursor > 0) {
        result.push(cursor);
        const parent = lineMap.listParentLine[cursor];
        cursor = parent > 0 ? parent : null;
    }
    return result;
}

export function listRoot(line: number, lineMap: LineMap): number | null {
    return subtreeRoot(line, lineMap);
}

function subtreeRoot(line: number, lineMap: LineMap): number | null {
    const nearest = listLineAtOrAbove(lineMap, line);
    if (nearest === null) return null;
    let cursor = nearest;
    while (cursor > 0) {
        if (lineMap.listSubtreeEndLine[cursor] >= line) return cursor;
        cursor = lineMap.listParentLine[cursor];
    }
    return null;
}

function listIndent(lineMap: LineMap, line: number): number | undefined {
    const meta = getLineMetaAt(lineMap, line);
    if (!meta || !meta.isList) return undefined;
    return meta.indentWidth;
}
