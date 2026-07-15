import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import { resolveDeleteRange, resolveInsertionChange } from '../mutation/document-change';
import { selectionLineRanges, type BlockSelection } from '../selection/block-selection';
import type { LineRange } from '../markdown/line-range-types';
import { parseLine } from '../parse/parse-line';
import type { ParsedLine } from '../parse/types';
import { insertTextForMove } from '../mutation/text-mutation-policy';
import type { MovePlan } from '../move/move-plan';
import type { DocEdit, TextChange } from './block-transaction';
import { reject, type Reject } from '../result';
import { renumberAllOrderedLists } from './list-renumber';
import { applyChanges, stringDoc } from './string-doc';

export type MoveSourceSegment = {
    lines: LineRange;
    from: number;
    to: number;
    deleteFrom: number;
    deleteTo: number;
};

export type MoveSourcePayload = {
    content: string;
    ranges: LineRange[];
    segments: MoveSourceSegment[];
};

export type CapturedMoveSource = {
    block: Block;
    payload: MoveSourcePayload;
};

export function captureMoveSource(doc: Doc, selection: BlockSelection): CapturedMoveSource | null {
    const ranges = selectionLineRanges(doc.lines, selection);
    if (ranges.length === 0) return null;

    const segments = ranges.map((range) => {
        const start = doc.line(range.startLine);
        const end = doc.line(range.endLine);
        const deleteRange = resolveDeleteRange(doc, start.from, end.to);
        return {
            lines: range,
            from: start.from,
            to: end.to,
            deleteFrom: deleteRange.from,
            deleteTo: deleteRange.to,
        };
    });
    const content = segments.map((s) => doc.sliceString(s.from, s.to)).join('\n');
    const first = ranges[0];
    const last = ranges[ranges.length - 1];

    return {
        block: {
            type: selection.blocks[0].type,
            lines: { startLine: first.startLine, endLine: last.endLine },
        },
        payload: { content, ranges, segments },
    };
}

/**
 * Compile a move into DocEdit[].
 *
 *   1. Project   — insert string from source + DropPosition
 *   2. Geometry  — insert + delete (coordinates on original doc)
 *   3. Normalize — apply geometry in memory, renumber ordered lists on result
 *   4. Emit      — if normalize empty: emit geometry changes;
 *                  else emit one replace of full text (sequential composition is
 *                  not the same as simultaneous geometry∪renumber on original)
 */
export function moveTx(params: {
    sourceDoc: Doc;
    plan: MovePlan;
}): DocEdit[] | Reject {
    const { sourceDoc, plan } = params;
    const targetDoc = plan.position.doc;
    const parse = (text: string) => parseLine(text, plan.tabSize);

    const insertText = insertTextForMove({
        doc: targetDoc,
        sourceBlock: plan.captured.block,
        targetLineNumber: plan.position.line,
        sourceContent: plan.captured.payload.content,
        position: plan.position,
        tabSize: plan.tabSize,
        indentUnit: plan.indentUnit,
    });
    if (!insertText.length) return reject('no_insert_text');

    if (sourceDoc !== targetDoc) {
        const insert = geometryInsert(targetDoc, plan.position.line, insertText);
        const del = geometryDelete(plan.captured.payload);
        return [
            compileDocEdit(targetDoc, insert, parse),
            compileDocEdit(sourceDoc, del, parse),
        ];
    }

    const geometry = geometrySameDoc({
        doc: targetDoc,
        payload: plan.captured.payload,
        targetLine: plan.position.line,
        insertText,
        allowInPlace: plan.allowIndent,
    });
    if ('type' in geometry) return geometry;
    return [compileDocEdit(targetDoc, geometry, parse)];
}

function compileDocEdit(
    doc: Doc,
    geometry: TextChange[],
    parse: (line: string) => ParsedLine,
): DocEdit {
    if (geometry.length === 0) {
        return { doc, changes: [] };
    }

    const original = doc.sliceString(0, doc.length);
    const afterGeometry = applyChanges(original, geometry);
    const renumber = renumberAllOrderedLists(stringDoc(afterGeometry), parse);

    // No ordered lists to fix — emit fine-grained geometry only.
    if (renumber.length === 0) {
        return { doc, changes: sortChanges(geometry) };
    }

    // Sequential composition: geometry then normalize on the result.
    // Must NOT merge renumber offsets with geometry as simultaneous original-coords
    // edits — that inserts new markers without removing old ones (double "1. 2.").
    const finalText = applyChanges(afterGeometry, renumber);
    return {
        doc,
        changes: [{ from: 0, to: original.length, insert: finalText }],
    };
}

function geometryInsert(doc: Doc, targetLine: number, insertText: string): TextChange[] {
    const insertion = resolveInsertionChange(doc, targetLine, insertText, {
        lengthAfterDelete: doc.length,
    });
    return [{ from: insertion.pos, to: insertion.pos, insert: insertion.text }];
}

function geometryDelete(payload: MoveSourcePayload): TextChange[] {
    return payload.segments.map((s) => ({
        from: s.deleteFrom,
        to: s.deleteTo,
        insert: '',
    }));
}

function geometrySameDoc(params: {
    doc: Doc;
    payload: MoveSourcePayload;
    targetLine: number;
    insertText: string;
    allowInPlace: boolean;
}): TextChange[] | Reject {
    const { doc, payload, targetLine, insertText, allowInPlace } = params;

    const deletedLen = payload.segments.reduce(
        (sum, s) => sum + (s.deleteTo - s.deleteFrom),
        0,
    );
    const insertion = resolveInsertionChange(doc, targetLine, insertText, {
        lengthAfterDelete: doc.length - deletedLen,
    });

    if (payload.segments.some(
        (s) => insertion.pos > s.deleteFrom && insertion.pos < s.deleteTo,
    )) {
        return reject('insertion_inside_deleted_range');
    }

    const first = payload.segments[0];
    if (allowInPlace && insertion.pos === first.deleteFrom) {
        return [{
            from: first.deleteFrom,
            to: first.deleteTo,
            insert: insertion.text,
        }];
    }

    return [
        { from: insertion.pos, to: insertion.pos, insert: insertion.text },
        ...geometryDelete(payload),
    ];
}

function sortChanges(changes: TextChange[]): TextChange[] {
    const key = (c: TextChange) => `${c.from}:${c.to}:${c.insert}`;
    const seen = new Set<string>();
    const out: TextChange[] = [];
    for (const c of [...changes].sort((a, b) => b.from - a.from || b.to - a.to)) {
        const k = key(c);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(c);
    }
    return out;
}
