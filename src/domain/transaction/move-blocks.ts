import type { Block } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import type { LineRange } from '../markdown/line-range-types';
import type { MovePlan } from '../move/move-plan';
import { insertTextForMove, resolveDeleteRange, resolveInsertionChange } from '../mutation';
import { isListLine, listMarkerType, parseLine } from '../parse/parse-line';
import type { ParsedLine } from '../parse/types';
import { type Reject, reject } from '../result';
import { type BlockSelection, selectionLineRanges } from '../selection/block-selection';
import type { DocEdit, TextChange } from './block-transaction';
import { renumberRunsNear } from './list-renumber';
import { buildPosMapper } from './pos-map';
import { stringDoc } from './string-doc';

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
 *   3. Renumber  — in memory, renumber only the ordered runs the move
 *                  touched, on the post-move doc
 *   4. Compose   — map the renumber marker edits back to original
 *                  coordinates and merge with the geometry: one simultaneous,
 *                  non-overlapping change set, no whole-document replace
 */
export function moveTx(params: { sourceDoc: Doc; plan: MovePlan }): DocEdit[] | Reject {
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
        return [compileDocEdit(targetDoc, insert, parse), compileDocEdit(sourceDoc, del, parse)];
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

function compileDocEdit(doc: Doc, geometry: TextChange[], parse: (line: string) => ParsedLine): DocEdit {
    if (geometry.length === 0) {
        return { doc, changes: [] };
    }

    const changes = sortChanges(geometry);
    const edited = stringDoc(applyChanges(doc, changes));
    const anchors = renumberAnchors(doc, changes, edited, parse);
    const renumber = renumberRunsNear(edited, parse, anchors);
    if (renumber.length === 0) {
        return { doc, changes };
    }
    return { doc, changes: composeOnOriginal(doc, changes, renumber) };
}

/**
 * Rows of the post-move doc whose ordered runs the move touched: rows around
 * the inserted block (only when it actually joins a neighbouring run) and
 * rows around each deleted range (a removed run member, or two run segments
 * that merge across the hole). Runs elsewhere stay untouched.
 */
function renumberAnchors(doc: Doc, geometry: TextChange[], edited: Doc, parse: (line: string) => ParsedLine): number[] {
    const sorted = [...geometry].sort((a, b) => a.from - b.from);
    const mapper = buildPosMapper(sorted, doc.length);
    const anchors = new Set<number>();
    const addRow = (mPos: number): void => {
        const p = Math.max(0, Math.min(edited.length, mPos));
        anchors.add(edited.lineAt(p).number);
    };

    for (const c of sorted) {
        if (c.insert.length > 0) {
            const start = c.from + editedDeltaBefore(sorted, c.from);
            const end = start + c.insert.length;
            const first = firstContentLine(c.insert);
            const last = lastContentLine(c.insert);
            if (start > 0 && isOrderedListItem(parse(first))) {
                const above = parse(lineTextAt(edited, start - 1));
                if (sameListRun(parse(first), above)) addRow(start - 1);
            }
            if (end < edited.length && isOrderedListItem(parse(last))) {
                const below = parse(lineTextAt(edited, end));
                if (sameListRun(parse(last), below)) addRow(end);
            }
        }
        if (c.to > c.from) {
            const after = mapper.forward(c.to);
            if (c.from > 0) {
                const before = mapper.forward(c.from - 1);
                if (before !== null) {
                    const r1 = parse(lineTextAt(edited, before));
                    const lastDeleted = parse(lineTextAt(doc, c.to - 1));
                    if (isOrderedListItem(lastDeleted) && sameListRun(r1, lastDeleted)) addRow(before);
                    if (after !== null && sameListRun(r1, parse(lineTextAt(edited, after)))) addRow(before);
                }
            }
            if (after !== null) {
                const r2 = parse(lineTextAt(edited, after));
                const firstDeleted = parse(lineTextAt(doc, c.from));
                if (isOrderedListItem(firstDeleted) && sameListRun(firstDeleted, r2)) addRow(after);
            }
        }
    }
    return [...anchors];
}

/** Text of the line containing a position. */
function lineTextAt(doc: Doc, pos: number): string {
    return doc.line(doc.lineAt(pos).number).text;
}

/**
 * Merge post-move renumber marker edits back onto the original doc:
 * marker edits inside the inserted text are folded into the insert string;
 * a marker edit at the insert seam merges into one change with the insert
 * (CM6 rejects overlapping ranges); the rest map to original coordinates.
 * Returns one simultaneous, non-overlapping change set on the original doc.
 */
function composeOnOriginal(doc: Doc, geometry: TextChange[], renumber: TextChange[]): TextChange[] {
    const sorted = [...geometry].sort((a, b) => a.from - b.from);
    const mapper = buildPosMapper(sorted, doc.length);

    let insert: TextChange | null = null;
    let insertStart = 0;
    let insertEnd = 0;
    for (const c of sorted) {
        if (c.insert.length > 0) {
            insert = c;
            insertStart = c.from + editedDeltaBefore(sorted, c.from);
            insertEnd = insert.from;
            break;
        }
    }
    let insertText = insert?.insert ?? '';

    const mapped: TextChange[] = [];
    for (const r of renumber) {
        const from = mapper.backward(r.from);
        const to = mapper.backward(r.to);
        if (insert && from === 'insert' && to === 'insert') {
            const offA = r.from - insertStart;
            const offB = r.to - insertStart;
            insertText = insertText.slice(0, offA) + r.insert + insertText.slice(offB);
        } else if (typeof from === 'number' && typeof to === 'number') {
            if (insert && insert.from === insert.to && from === insert.from) {
                insertText = insertText + r.insert;
                insertEnd = Math.max(insertEnd, to);
            } else {
                mapped.push({ from, to, insert: r.insert });
            }
        }
        // Marker edits never straddle an insert boundary or a deleted range;
        // any such case is dropped defensively.
    }

    const out: TextChange[] = [];
    for (const c of sorted) {
        if (c === insert) {
            out.push({ from: insert.from, to: insertEnd, insert: insertText });
        } else {
            out.push(c);
        }
    }
    return sortChanges([...out, ...mapped]);
}

/** Edited-doc offset contributed by changes strictly before `from`. */
function editedDeltaBefore(sorted: TextChange[], from: number): number {
    let delta = 0;
    for (const c of sorted) {
        if (c.from >= from) break;
        delta += c.insert.length - (c.to - c.from);
    }
    return delta;
}

/** First / last non-empty line of inserted text — leading and trailing
 * newlines are line terminators, not block content. */
function firstContentLine(text: string): string {
    for (const line of text.split('\n')) {
        if (line.trim().length > 0) return line;
    }
    return '';
}

function lastContentLine(text: string): string {
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        if (lines[i].trim().length > 0) return lines[i];
    }
    return '';
}

function isOrderedListItem(p: ParsedLine): boolean {
    return isListLine(p) && listMarkerType(p) === 'ordered';
}

/** Two lines belong to the same list run when indent and quote depth match. */
function sameListRun(a: ParsedLine, b: ParsedLine): boolean {
    return isListLine(a) && isListLine(b) && a.indent.width === b.indent.width && a.quote.depth === b.quote.depth;
}

/** Apply non-overlapping TextChanges to a doc and return the resulting text. */
function applyChanges(doc: Doc, changes: TextChange[]): string {
    let out = '';
    let pos = 0;
    for (const c of [...changes].sort((a, b) => a.from - b.from)) {
        out += doc.sliceString(pos, c.from) + c.insert;
        pos = c.to;
    }
    return out + doc.sliceString(pos, doc.length);
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

    const deletedLen = payload.segments.reduce((sum, s) => sum + (s.deleteTo - s.deleteFrom), 0);
    const insertion = resolveInsertionChange(doc, targetLine, insertText, {
        lengthAfterDelete: doc.length - deletedLen,
    });

    if (payload.segments.some((s) => insertion.pos > s.deleteFrom && insertion.pos < s.deleteTo)) {
        return reject('insertion_inside_deleted_range');
    }

    const first = payload.segments[0];
    if (allowInPlace && insertion.pos === first.deleteFrom) {
        return [
            {
                from: first.deleteFrom,
                to: first.deleteTo,
                insert: insertion.text,
            },
        ];
    }

    return [{ from: insertion.pos, to: insertion.pos, insert: insertion.text }, ...geometryDelete(payload)];
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
