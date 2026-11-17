import { detectBlock, inheritFrontmatterEnd } from '../block/block-detector';
import { type Block, BlockType } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import { blockAt, gapAt } from '../markdown/gap';
import { getLineMap, type LineMap, quoteRunAt } from '../markdown/line-map';
import type { LineRange } from '../markdown/line-range-types';
import type { MovePlan } from '../move/move-plan';
import {
    collapsedBlankLines,
    continuesOrderedRun,
    insertIntoGap,
    insertTextForMove,
    type PayloadEnd,
    removeSegment,
    startsListUnderList,
} from '../mutation';
import { parseLine } from '../parse/parse-line';
import type { ParsedLine } from '../parse/types';
import { isReject, type Reject, reject } from '../result';
import { facingAt, isStandalone, runKind, runLines } from '../rules/separation';
import { type BlockSelection, selectionSegments } from '../selection/block-selection';
import type { DocEdit, TextChange } from './block-transaction';
import { renumberRunsNear } from './list-renumber';
import { buildPosMapper } from './pos-map';
import { stringDoc } from './string-doc';

export type CapturedMoveSource = {
    /** Top-level selected blocks, in document order. */
    blocks: Block[];
    /** Lines that move together: blocks separated only by blank lines, with those blank lines. */
    segments: LineRange[];
    /** The segments joined the way their holes close at the source. */
    content: string;
    /** Offsets in `content` where each of `blocks` starts. */
    starts: number[];
    first: PayloadEnd;
    last: PayloadEnd;
};

export function captureMoveSource(
    doc: Doc,
    selection: BlockSelection,
    options: { lineMap: LineMap; tabSize: number },
): CapturedMoveSource | null {
    const { blocks, segments } = selectionSegments(selection, options);
    if (segments.length === 0) return null;

    const text = (from: number, to: number) => doc.sliceString(doc.line(from).from, doc.line(to).to);
    let content = text(segments[0].startLine, segments[0].endLine);
    // Where each segment starts in `content`.
    const offsets = [0];
    for (let i = 1; i < segments.length; i++) {
        const upper = segments[i - 1].endLine;
        const lower = segments[i].startLine;
        const blankAbove = options.lineMap.nextNonEmpty[upper + 1] - upper - 1;
        const blankBelow = lower - options.lineMap.prevNonEmpty[lower - 1] - 1;
        const removed = { startLine: upper + 1 + blankAbove, endLine: lower - 1 - blankBelow };
        const kept = collapsedBlankLines(
            doc,
            {
                upper: facingAt(doc, upper, options),
                lower: facingAt(doc, lower, options),
                blankAbove,
                blankBelow,
                removed,
            },
            options,
        );
        content += `\n${'\n'.repeat(kept)}`;
        offsets.push(content.length);
        content += text(segments[i].startLine, segments[i].endLine);
    }
    const starts = blocks.map((block) => {
        const at = segments.findIndex((s) => block.lines.startLine <= s.endLine);
        return offsets[at] + doc.line(block.lines.startLine).from - doc.line(segments[at].startLine).from;
    });

    const firstLine = segments[0].startLine;
    const lastLine = segments[segments.length - 1].endLine;
    // A paragraph or quote end was kept apart when its whole paragraph or quote moves with it.
    const standalone = (line: number, block: Block) => {
        if (block.type !== BlockType.Paragraph && block.type !== BlockType.Blockquote) {
            return isStandalone(doc, block, options);
        }
        const run = runLines(doc, line, options);
        return segments.some((s) => s.startLine <= run.startLine && run.endLine <= s.endLine);
    };
    const end = (line: number, block: Block): PayloadEnd => {
        const facing = detectBlock(doc, line, options);
        if (!facing) throw new Error(`md-dragger: no block at payload line ${line}`);
        return {
            type: facing.type,
            run: runKind(doc, line, options),
            standalone: standalone(line, block),
            selected: block.type,
        };
    };
    return {
        blocks,
        segments,
        content,
        starts,
        first: end(firstLine, blocks[0]),
        last: end(lastLine, blocks[blocks.length - 1]),
    };
}

/**
 * Compile a move or copy into edits without applying them. Copy mode edits only
 * the target document; a cross-document move returns target then source edits.
 * Rejects empty projected text or an insertion inside a deleted range.
 * Errors from document access and text projection propagate.
 *
 *   1. Project   — insert string from source + DropPosition
 *   2. Geometry  — one insertion into the target gap (resolved as if the
 *                  moved segments were already removed) plus one pure
 *                  deletion per segment, on the original doc
 *   3. Renumber  — in memory, renumber only the ordered runs the move
 *                  touched, on the post-move doc
 *   4. Compose   — map the renumber marker edits back to original
 *                  coordinates and merge with the geometry: one simultaneous,
 *                  non-overlapping change set, no whole-document replace
 */
export function moveTx(params: { sourceDoc: Doc; plan: MovePlan }): DocEdit[] | Reject {
    const { sourceDoc, plan } = params;
    const targetDoc = plan.position.doc;
    const { tabSize } = plan;
    const parse = (text: string) => parseLine(text, tabSize);

    if (plan.allowIndent) {
        const relevelled = relevelInPlace(sourceDoc, plan.captured, (blocks, text, starts) =>
            project(plan, blocks, text, starts),
        );
        return [compileDocEdit(sourceDoc, relevelled, parse)];
    }

    const step = moveInsertion(sourceDoc, plan);
    if (isReject(step)) return step;
    const { insertion, removals } = step;
    if (plan.mode === 'copy' || sourceDoc !== targetDoc) {
        const inserted = compileDocEdit(targetDoc, [insertion], parse);
        return plan.mode === 'copy' ? [inserted] : [inserted, compileDocEdit(sourceDoc, removals, parse)];
    }
    return [compileDocEdit(sourceDoc, [insertion, ...removals], parse)];
}

/**
 * The geometry of a move or copy that is not an in-place indent change: the
 * insertion into the target gap, on the original target document, and the
 * removal of each segment from the source. planMove reads the line the
 * insertion lands on. Rejects empty projected text, or a same-document gap
 * that the removal puts inside a block.
 */
export function moveInsertion(
    sourceDoc: Doc,
    plan: MovePlan,
): { insertion: TextChange; removals: TextChange[] } | Reject {
    const targetDoc = plan.position.doc;
    const { tabSize } = plan;
    const text = project(plan, plan.captured.blocks, plan.captured.content, plan.captured.starts);
    if (!text.length) return reject('no_insert_text');
    // A payload written as list items faces its neighbours as list items.
    const item: PayloadEnd = { type: BlockType.ListItem, run: 'list', standalone: false, selected: BlockType.ListItem };
    const payload = plan.asItems
        ? { text, first: item, last: item }
        : { text, first: plan.captured.first, last: plan.captured.last };
    const sourceLineMap = getLineMap(sourceDoc, { tabSize });
    const removals = plan.captured.segments.map((segment) =>
        removeSegment(sourceDoc, segment, {
            lineMap: sourceLineMap,
            tabSize,
            renumbers: true,
            blocks: plan.captured.blocks,
        }),
    );

    // A copy, or a move to another document, inserts into the target as it is.
    if (plan.mode === 'copy' || sourceDoc !== targetDoc) {
        const targetLineMap = getLineMap(targetDoc, { tabSize });
        const first = plan.captured.segments[0].startLine;
        const insertion = insertIntoGap(targetDoc, plan.gap, payload, {
            lineMap: targetLineMap,
            tabSize,
            parent: plan.position.parent,
            standalone: (block) => isStandalone(targetDoc, block, { lineMap: targetLineMap }),
            fromQuote: (line) => {
                if (sourceDoc !== targetDoc) return false;
                const run = quoteRunAt(targetLineMap, line);
                return run.startLine <= first && first <= run.endLine;
            },
            zone: plan.position.zone,
            line: plan.position.line,
        });
        return { insertion, removals };
    }

    const insertion = insertAfterRemoval(sourceDoc, plan, payload, removals);
    if (isReject(insertion)) return insertion;
    return { insertion, removals };
}

/** The text a move writes for `sourceContent`, where `blocks` start at `starts`: as list items or relevelled for the
 * drop position (insertTextForMove). */
function project(plan: MovePlan, blocks: Block[], sourceContent: string, starts: number[]): string {
    return insertTextForMove({
        blocks,
        sourceContent,
        starts,
        position: plan.position,
        asItems: plan.asItems,
        tabSize: plan.tabSize,
        indentUnit: plan.indentUnit,
    });
}

/** An in-place list indent change: each segment's lines are replaced by their relevelled text, separators unchanged. */
function relevelInPlace(
    doc: Doc,
    { blocks, segments }: CapturedMoveSource,
    project: (blocks: Block[], text: string, starts: number[]) => string,
): TextChange[] {
    return segments.map((s) => {
        const from = doc.line(s.startLine).from;
        const to = doc.line(s.endLine).to;
        const own = blocks.filter(
            (block) => block.lines.startLine >= s.startLine && block.lines.startLine <= s.endLine,
        );
        const starts = own.map((block) => doc.line(block.lines.startLine).from - from);
        return { from, to, insert: project(own, doc.sliceString(from, to), starts) };
    });
}

/** The source document with a move's deletions applied, kept per source document for the deletions it was built
 * from: every frame of a drag plans the same removal. */
const removedDocs = new WeakMap<Doc, { key: string; removed: Doc }>();

/**
 * The insertion of a same-document move. The destination gap is resolved on
 * the document with the segments removed — a removed neighbour is replaced by
 * its surviving neighbour, and the gap's blank lines by the collapsed ones —
 * and so is the drop's boundary line, at the deletion point when the removal
 * deletes it; the insertion offset is mapped back onto the original doc, at
 * the far boundary of any deleted range it touches. Rejected when that gap
 * lies inside a block.
 */
function insertAfterRemoval(
    doc: Doc,
    plan: MovePlan,
    payload: { text: string; first: PayloadEnd; last: PayloadEnd },
    removals: TextChange[],
): TextChange | Reject {
    const { tabSize } = plan;
    const deletions = [...removals].sort((a, b) => a.from - b.from);
    const key = deletions.map((d) => `${d.from}:${d.to}`).join(',');
    let memo = removedDocs.get(doc);
    if (memo?.key !== key) {
        const fresh = stringDoc(applyChanges(doc, deletions));
        inheritFrontmatterEnd(fresh, doc);
        memo = { key, removed: fresh };
        removedDocs.set(doc, memo);
    }
    const { removed } = memo;
    const lineMap = getLineMap(removed, { tabSize });
    const lineAfterRemoval = (line: number) =>
        removed.lineAt(offsetAfterRemoval(deletions, doc.line(line).from)).number;
    // The drop parent never moves. The gap's lower neighbour moves only in the source's own upper gap: the line
    // after its segment takes its place.
    const docLineMap = getLineMap(doc, { tabSize });
    const segment = plan.captured.segments.find((s) => plan.gap.seam >= s.startLine && plan.gap.seam <= s.endLine);
    const below = !plan.gap.below ? 0 : !segment ? plan.gap.seam : docLineMap.nextNonEmpty[segment.endLine + 1];

    // Removing an unclosed fence can pair the fences below it differently: the gap can then lie inside a block.
    const at = gapAt(removed, below > 0 ? lineAfterRemoval(below) : removed.lines + 1, { lineMap, tabSize });
    if (at.type !== 'gap') return reject(at.reason);
    const parent =
        plan.position.parent && blockAt(removed, lineAfterRemoval(plan.position.parent.lines.startLine), { tabSize });
    // Whether a neighbour was kept apart, and which quote it is in, are properties of the document the user sees:
    // read them on the original lines.
    const originalLine = (line: number) => doc.lineAt(offsetBeforeRemoval(deletions, removed.line(line).from)).number;
    const standalone = (block: Block): boolean =>
        isStandalone(doc, blockAt(doc, originalLine(block.lines.startLine), { tabSize }), { lineMap: docLineMap });
    const fromQuote = (line: number): boolean => {
        const run = quoteRunAt(docLineMap, originalLine(line));
        const first = plan.captured.segments[0].startLine;
        return run.startLine <= first && first <= run.endLine;
    };
    // The drop line maps to the deletion point when the removal deletes it; every other line read here survives.
    const dropLine = (line: number) => {
        const from = doc.line(line).from;
        const cut = deletions.find((d) => d.from < from && from < d.to);
        return removed.lineAt(offsetAfterRemoval(deletions, cut ? cut.from : from)).number;
    };
    const line = plan.position.line > doc.lines ? removed.lines + 1 : dropLine(plan.position.line);
    const insertion = insertIntoGap(removed, at.gap, payload, {
        lineMap,
        tabSize,
        parent,
        standalone,
        fromQuote,
        zone: plan.position.zone,
        line,
    });

    const pos = offsetBeforeRemoval(deletions, insertion.from);
    return { from: pos, to: pos, insert: insertion.insert };
}

/** Offset in the original document of an offset in the document with `deletions` (sorted, pure) applied: at the far
 * boundary of any deleted range it touches. */
function offsetBeforeRemoval(deletions: TextChange[], pos: number): number {
    let original = pos;
    for (const d of deletions) {
        if (d.from > original) break;
        original += d.to - d.from;
    }
    return original;
}

/** Offset in the document with `deletions` (sorted, pure) applied, for an offset outside every deleted range. */
function offsetAfterRemoval(deletions: TextChange[], pos: number): number {
    let removedBefore = 0;
    for (const d of deletions) {
        if (pos > d.from && pos < d.to) throw new Error(`md-dragger: offset ${pos} lies inside a moved range`);
        if (d.to <= pos) removedBefore += d.to - d.from;
    }
    return pos - removedBefore;
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
 * that merge across the hole), plus an ordered item the move leaves starting
 * a list under a list line. Runs elsewhere stay untouched.
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
            // The inserted block's own first and last rows: its leading and
            // trailing newlines are separators, so the rows next to it are
            // the ones past them.
            const start = c.from + editedDeltaBefore(sorted, c.from) + leadingNewlines(c.insert);
            const end = c.from + editedDeltaBefore(sorted, c.from) + c.insert.length - trailingNewlines(c.insert);
            const first = firstContentLine(c.insert);
            const last = lastContentLine(c.insert);
            if (start > 0 && continuesOrderedRun(parse(first), parse(lineTextAt(edited, start - 1)))) {
                addRow(start - 1);
            }
            if (end < edited.length && continuesOrderedRun(parse(last), parse(lineTextAt(edited, end + 1)))) {
                addRow(end + 1);
            }
            // Every written row, where the payload's own segments meet, and the row after it.
            const rows = edited.lineAt(Math.min(end + 1, edited.length)).number;
            for (let row = edited.lineAt(start).number; row <= rows; row++) {
                if (startsListUnderList(edited, row - 1, parse(edited.line(row).text), parse)) anchors.add(row);
            }
        }
        if (c.to > c.from) {
            // A deletion that reaches the document end has no row after it. A change that ends at the end of a
            // line keeps its terminator (an in-place write, or a removal that leaves a blank line): the row after
            // it is past that terminator.
            const end = c.to < doc.length ? mapper.forward(c.to) : null;
            const keepsTerminator = doc.line(doc.lineAt(c.to).number).from < c.to;
            const after = end !== null && keepsTerminator ? end + 1 : end;
            // A run is a stack of adjacent lines. Across the blank lines removed with a segment, the row on the
            // other side is renumbered on its own: only right for the row below when it becomes the head.
            const blank = (line: number) => line < 1 || doc.line(line).text.trim().length === 0;
            if (c.from > 0) {
                const before = mapper.forward(c.from - 1);
                if (before !== null) {
                    const r1 = parse(lineTextAt(edited, before));
                    const lastDeleted = parse(lineTextAt(doc, c.to - 1));
                    const tightAbove = !blank(doc.lineAt(c.from - 1).number + 1);
                    if (tightAbove && continuesOrderedRun(r1, lastDeleted)) addRow(before);
                    if (after !== null && continuesOrderedRun(r1, parse(lineTextAt(edited, after)))) addRow(before);
                }
            }
            if (after !== null) {
                const r2 = parse(lineTextAt(edited, after));
                const first = doc.lineAt(c.from).number;
                const firstDeleted = parse(doc.line(first).text);
                let above = first - 1;
                while (above > 0 && blank(above)) above--;
                const head = above === 0 || !continuesOrderedRun(parse(doc.line(above).text), firstDeleted);
                const tightBelow = !blank(doc.lineAt(c.to - 1).number);
                if ((tightBelow || head) && continuesOrderedRun(firstDeleted, r2)) addRow(after);
                // Below the blank line a removal leaves, the run that lost the deleted lines right above it starts
                // over when the nearest of them at its level was in it.
                if (keepsTerminator && c.insert.length === 0) {
                    let level = doc.lineAt(c.to - 1).number;
                    while (
                        level > first &&
                        (blank(level) || parse(doc.line(level).text).indent.width > r2.indent.width)
                    ) {
                        level--;
                    }
                    if (continuesOrderedRun(parse(doc.line(level).text), r2)) addRow(after);
                }
                const row = edited.lineAt(after).number;
                if (startsListUnderList(edited, row - 1, parse(edited.line(row).text), parse)) addRow(after);
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
 * Merge post-move renumber marker edits back onto the original doc: a marker
 * edit inside a change's written text is folded into that change's text; a
 * marker edit at a pure insertion's seam merges into one change with it (CM6
 * rejects overlapping ranges); the rest map to original coordinates. Every
 * change keeps its own replaced range. Returns one simultaneous,
 * non-overlapping change set on the original doc.
 */
function composeOnOriginal(doc: Doc, geometry: TextChange[], renumber: TextChange[]): TextChange[] {
    const sorted = [...geometry].sort((a, b) => a.from - b.from);
    const mapper = buildPosMapper(sorted, doc.length);
    // Each change that writes text, with the offset of that text in the edited doc.
    const writes = sorted
        .filter((c) => c.insert.length > 0)
        .map((c) => ({
            from: c.from,
            to: c.to,
            pure: c.from === c.to,
            start: c.from + editedDeltaBefore(sorted, c.from),
            insert: c.insert,
        }));

    const mapped: TextChange[] = [];
    // Right to left, so folding one edit into a text never shifts the offsets of the next.
    for (const r of [...renumber].sort((a, b) => b.from - a.from)) {
        // Inside written text, its end included: an empty item's marker can end exactly where the text ends.
        const write = writes.find((w) => r.from >= w.start && r.to <= w.start + w.insert.length);
        if (write) {
            write.insert =
                write.insert.slice(0, r.from - write.start) + r.insert + write.insert.slice(r.to - write.start);
            continue;
        }
        const from = mapper.backward(r.from);
        const to = mapper.backward(r.to);
        if (typeof from === 'number' && typeof to === 'number') {
            const seam = writes.find((w) => w.pure && w.from === from);
            if (seam) {
                seam.insert += r.insert;
                seam.to = to;
            } else {
                mapped.push({ from, to, insert: r.insert });
            }
        }
        // Marker edits never straddle an insert boundary or a deleted range;
        // any such case is dropped defensively.
    }

    const deletions = sorted.filter((c) => c.insert.length === 0);
    return sortChanges([...writes.map(({ from, to, insert }) => ({ from, to, insert })), ...deletions, ...mapped]);
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

function leadingNewlines(text: string): number {
    return text.length - text.replace(/^\n+/, '').length;
}

function trailingNewlines(text: string): number {
    return text.length - text.replace(/\n+$/, '').length;
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

/** Apply non-overlapping TextChanges to a doc and return the resulting text. */
export function applyChanges(doc: Doc, changes: TextChange[]): string {
    let out = '';
    let pos = 0;
    for (const c of [...changes].sort((a, b) => a.from - b.from)) {
        out += doc.sliceString(pos, c.from) + c.insert;
        pos = c.to;
    }
    return out + doc.sliceString(pos, doc.length);
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
