import { detectBlock, frontmatterEndLine } from './block/block-detector';
import { formatBlockContent } from './block/block-type-conversion';
import type { Block } from './block/block-types';
import { BlockType } from './block/block-types';
import type { DropPosition, DropZone } from './command/drop-position';
import type { Doc } from './markdown/document-types';
import { dropIndentWidth } from './markdown/drop-locate';
import type { Gap } from './markdown/gap';
import { type LineMap, listItemContaining, quoteRunAt } from './markdown/line-map';
import type { LineRange } from './markdown/line-range-types';
import { formatIndent, indentWidth, isListLine, listMarkerText, listMarkerType, parseLine } from './parse/parse-line';
import type { ParsedLine } from './parse/types';
import { calloutCovers, itemText } from './rules/container-policy';
import { type Facing, facingAt, needsBlankLine, type RunKind, runKind } from './rules/separation';
import type { TextChange } from './transaction/block-transaction';

/** One end of a moved payload: the innermost block at its facing line, that line's run kind, whether its block
 * was kept apart at the source, and the type of the selected block at that end. */
export type PayloadEnd = { type: BlockType; run: RunKind | null; standalone: boolean; selected: BlockType };

/**
 * A line payload end: a paragraph or quote line cut from a larger paragraph or
 * quote that partly stays. Only such an end can join the line the pointer
 * chose (DropPosition.zone); a callout ending in a nested quote line is not one.
 */
export function isLinePayloadEnd(end: PayloadEnd): boolean {
    const line = end.selected === BlockType.Paragraph || end.selected === BlockType.Blockquote;
    return line && end.run !== null && end.run !== 'list' && !end.standalone;
}

type SpacingContext = { lineMap: LineMap; tabSize: number };

/**
 * Write the payload into a gap as one point insertion, with the blank lines
 * on each side computed from the gap's own blank lines, needsBlankLine, the
 * run kinds and the standalone property. Padding, frontmatter and the final
 * newline stay where they are. In an interior gap with blank lines, `line` is
 * the boundary the drop chose (the seam before it, clamped into the gap): the
 * gap's blank lines above it stay above the payload and the rest below, and a
 * side left with none gets one. A side a list sets (sideSpacing) keeps its
 * count and fixes the boundary instead, and the other side takes the rest.
 * `standalone` tells whether a gap neighbour was kept apart, in the document
 * the user sees (not a temporary one with the moved blocks removed), and
 * `fromQuote` whether the payload comes from the quote a quoted neighbour line
 * belongs to. `zone` is the drop's effective zone: a join writes the payload
 * tight to that side, and fixes the boundary there; a line payload apart in a
 * gap of two or more blank lines lands between two of them.
 */
export function insertIntoGap(
    doc: Doc,
    gap: Gap,
    payload: { text: string; first: PayloadEnd; last: PayloadEnd },
    options: {
        lineMap: LineMap;
        tabSize: number;
        parent: Block | null;
        standalone: (neighbour: Block) => boolean;
        fromQuote: (neighbourLine: number) => boolean;
        zone: DropZone | undefined;
        line: number;
    },
): TextChange {
    const { lineMap, tabSize } = options;
    const { text } = payload;
    const textLines = text.split('\n');
    const ends = {
        top: { ...payload.first, facing: { type: payload.first.type, line: parseLine(textLines[0], tabSize) } },
        bottom: {
            ...payload.last,
            facing: { type: payload.last.type, line: parseLine(textLines[textLines.length - 1], tabSize) },
        },
    };
    const aboveLine = gap.above ? lineMap.prevNonEmpty[gap.seam - 1] : 0;
    // A join writes the line tight to the neighbour it joins; the gap's blank lines stay on the far side. Apart at
    // a document edge (the pointer over padding) writes a line payload as its own paragraph or quote.
    const edge = gap.above === null || gap.below === null;
    const spacing = (side: 'top' | 'bottom', block: Block, line: number): number | null => {
        if (options.zone === (side === 'top' ? 'joinAbove' : 'joinBelow')) return 0;
        const s = sideSpacing(
            doc,
            gap,
            side,
            { block, line, facing: facingAt(doc, line, options) },
            ends[side],
            options,
        );
        return s !== null && options.zone === 'apart' && edge && isLinePayloadEnd(ends[side]) ? Math.max(s, 1) : s;
    };

    if (gap.above && gap.below) {
        const k = gap.blankLines;
        // The side away from a join keeps at least the gap's blank lines.
        const awayFromJoin = (s: number | null) => (s === null ? k : Math.max(s, k));
        const sBot =
            options.zone === 'joinAbove'
                ? awayFromJoin(spacing('bottom', gap.below, gap.seam))
                : spacing('bottom', gap.below, gap.seam);
        // An ordered run written tight onto the ordered run below joins it and is renumbered from 1.
        const head = ends.top.facing.line;
        const joinsRunBelow =
            sBot === 0 &&
            continuesOrderedRun(head, facingAt(doc, gap.seam, options).line) &&
            textLines.every((line) => continuesOrderedRun(head, parseLine(line, tabSize)));
        if (joinsRunBelow) ends.top.facing = asRunHead(ends.top.facing);
        const sTop =
            options.zone === 'joinBelow'
                ? awayFromJoin(spacing('top', gap.above, aboveLine))
                : spacing('top', gap.above, aboveLine);
        // The boundary the drop chose. A line payload apart takes one between two of the gap's blank lines: at the
        // first or the last it would sit on a neighbour's edge, where a join paints.
        const pointer = Math.max(0, Math.min(k, options.line - aboveLine - 1));
        const x = options.zone === 'apart' && k >= 2 ? Math.max(1, Math.min(k - 1, pointer)) : pointer;
        // `kept`: the gap's own blank lines that stay above the payload, where its first line lands. A side a list
        // or a join sets fixes it; when that leaves the top without a blank line, the one it gets is the gap's own.
        const kept =
            sTop !== null ? Math.min(sTop, k) : sBot !== null ? Math.max(k - Math.min(sBot, k), Math.min(1, k)) : x;
        const top = sTop ?? Math.max(kept, 1);
        const bottom = sBot ?? Math.max(k - kept, 1);
        if (top + bottom < k) {
            throw new Error(`md-dragger: ${top} + ${bottom} blank lines cannot hold a gap of ${k}`);
        }
        const at = doc.line(aboveLine + 1 + kept).from;
        return insertAt(at, `${'\n'.repeat(top - kept)}${text}\n${'\n'.repeat(bottom - (k - kept))}`);
    }
    // An edge has no blank lines of its own: sideSpacing sets each side.
    const edgeSpacing = (side: 'top' | 'bottom', block: Block, line: number): number => {
        const s = spacing(side, block, line);
        if (s === null) throw new Error(`md-dragger: the ${side} side of an edge has no blank lines to take`);
        return s;
    };
    if (gap.below) {
        return insertAt(doc.line(gap.seam).from, `${text}\n${'\n'.repeat(edgeSpacing('bottom', gap.below, gap.seam))}`);
    }
    if (gap.above) {
        return insertAt(doc.line(aboveLine).to, `\n${'\n'.repeat(edgeSpacing('top', gap.above, aboveLine))}${text}`);
    }
    if (doc.length === 0) return insertAt(0, text);
    const frontmatterEnd = frontmatterEndLine(doc);
    if (frontmatterEnd === doc.lines) return insertAt(doc.length, `\n${text}`);
    return insertAt(doc.line(frontmatterEnd + 1).from, `${text}\n`);
}

function insertAt(pos: number, insert: string): TextChange {
    return { from: pos, to: pos, insert };
}

/**
 * Blank lines between the payload end `end` and the gap neighbour `neighbour`
 * on one side, or null when the gap's own blank lines decide (an interior gap
 * with blank lines: insertIntoGap splits them):
 *   1. a list item next to a list takes the spacing of the list it joins,
 *      per side, so a list it does not join stays tight or loose; between two
 *      items of that list it keeps the gap's blank lines on both sides;
 *   2. a quote line inside a tight quote run joins the run;
 *   3. otherwise the gap's own blank lines; in a tight gap or at an edge, one
 *      blank line when the payload end was standalone, when it would join a
 *      quote it did not come from, when the two lines would not stay apart,
 *      or when they would join a standalone neighbour of the same paragraph or
 *      quote kind, and none otherwise.
 */
function sideSpacing(
    doc: Doc,
    gap: Gap,
    side: 'top' | 'bottom',
    neighbour: { line: number; block: Block; facing: Facing },
    end: PayloadEnd & { facing: Facing },
    options: SpacingContext & {
        parent: Block | null;
        standalone: (neighbour: Block) => boolean;
        fromQuote: (neighbourLine: number) => boolean;
    },
): number | null {
    const { lineMap } = options;
    const interior = gap.above !== null && gap.below !== null;
    const k = interior ? gap.blankLines : 0;
    const upper = side === 'top' ? neighbour.facing : end.facing;
    const lower = side === 'top' ? end.facing : neighbour.facing;
    const neighbourRun = runKind(doc, neighbour.line, options);

    if (end.run === 'list' && neighbourRun === 'list') {
        // Each side takes the spacing of the list it belongs to: a neighbour in the list the item joins (at its
        // target level) sets the joined list's spacing, unless both are in it, when each keeps k; the parent's own
        // lines above an item that starts its sublist stay tight to it; next to any other list line the gap's own
        // blank lines decide.
        const parentLine = options.parent?.lines.startLine ?? 0;
        const otherLine = side === 'top' ? gap.seam : gap.seam - gap.blankLines - 1;
        const both = interior && listItemOutsideQuote(lineMap, otherLine, parentLine) !== null;
        const item = listItemOutsideQuote(lineMap, neighbour.line, parentLine);
        if (item === null && !(side === 'top' && options.parent && !both) && k > 0) return null;
        const spacing =
            item !== null && !both
                ? listJoinSpacing(lineMap, item, side, parentLine)
                : side === 'top' && options.parent && !both
                  ? 0
                  : k;
        // A paragraph line of the list right under the payload's unquoted item line is content the item adopts:
        // tight, as it was there.
        const adopts =
            side === 'bottom' &&
            upper.type === BlockType.ListItem &&
            upper.line.quote.depth === 0 &&
            lower.type === BlockType.Paragraph;
        // Two quoted children written together are one quote, unless the lower one starts left of the upper one's
        // `>`, in an outer item.
        const lead = ({ line: { quote } }: Facing) =>
            indentWidth(quote.prefix.slice(0, quote.prefix.length - quote.prefix.trimStart().length), options.tabSize);
        const joinsQuote =
            upper.line.quote.depth > 0 &&
            lower.line.quote.depth > 0 &&
            lead(lower) >= lead(upper) &&
            !options.fromQuote(neighbour.line);
        return spacing === 0 && (joinsQuote || (!adopts && needsBlankLine(upper, lower))) ? 1 : spacing;
    }
    if (
        interior &&
        k === 0 &&
        lineMap.lineMeta[gap.seam - 1].quoteDepth > 0 &&
        lineMap.lineMeta[gap.seam].quoteDepth > 0
    ) {
        return 0;
    }
    if (k > 0) return null;
    // Two quoted lines written together are one quote.
    if (upper.line.quote.depth > 0 && lower.line.quote.depth > 0 && !options.fromQuote(neighbour.line)) return 1;
    if (end.standalone || needsBlankLine(upper, lower)) return 1;
    const sameKind = end.run !== null && end.run !== 'list' && end.run === neighbourRun;
    return sameKind && options.standalone(neighbour.block) ? 1 : 0;
}

/**
 * Item spacing of the list the payload joins at its target level (under
 * `parentLine`, or at the root), from the neighbour's `item` of it: the blank
 * lines between that list's two items nearest the gap on the neighbour's
 * side, or 0 when it has fewer than two.
 */
function listJoinSpacing(lineMap: LineMap, item: number, side: 'top' | 'bottom', parentLine: number): number {
    if (side === 'top') {
        const previous = lineMap.prevNonEmpty[item - 1];
        return previous > 0 && listItemOutsideQuote(lineMap, previous, parentLine) !== null ? item - previous - 1 : 0;
    }
    const end = lineMap.listSubtreeEndLine[item];
    const next = lineMap.nextNonEmpty[end + 1];
    return next > 0 && listItemOutsideQuote(lineMap, next, parentLine) === next ? next - end - 1 : 0;
}

/** listItemContaining among lists outside any quote: a list inside a quote belongs to its quote, never the list a
 * payload joins. */
function listItemOutsideQuote(lineMap: LineMap, line: number, parentLine: number): number | null {
    const outermost = listItemContaining(lineMap, line, 0);
    if (outermost === null || lineMap.lineMeta[outermost].quoteDepth > 0) return null;
    return listItemContaining(lineMap, line, parentLine);
}

/**
 * Remove one segment (lines that move or are deleted together) as one pure
 * deletion. Between two surviving neighbours U and L the two gaps collapse
 * into one; at a document edge the segment goes with its blank lines on the
 * inner side, and padding, frontmatter and the final newline stay.
 * `renumbers`: the caller renumbers the ordered runs it touches (a move does,
 * a delete does not), so L may inherit the head of its run. `blocks`: the
 * removed blocks.
 */
export function removeSegment(
    doc: Doc,
    segment: LineRange,
    options: SpacingContext & { renumbers: boolean; blocks: Block[] },
): TextChange {
    const { lineMap } = options;
    const { startLine, endLine } = segment;
    const line = (n: number) => doc.line(n);
    const aboveLine = startLine > 1 ? lineMap.prevNonEmpty[startLine - 1] : 0;
    const upper = aboveLine > frontmatterEndLine(doc) ? aboveLine : 0;
    const lower = endLine < doc.lines ? lineMap.nextNonEmpty[endLine + 1] : 0;

    if (upper > 0 && lower > 0) {
        const blankAbove = startLine - upper - 1;
        const blankBelow = lower - endLine - 1;
        // Removing the head of an ordered run makes L the head, which a renumbering numbers 1.
        const lowerFacing = facingAt(doc, lower, options);
        const inheritsHead =
            options.renumbers &&
            continuesOrderedRun(parseLine(line(startLine).text, options.tabSize), lowerFacing.line);
        const upperFacing = facingAt(doc, upper, options);
        const collapsed = collapsedBlankLines(
            doc,
            {
                upper: upperFacing,
                lower: inheritsHead ? asRunHead(lowerFacing) : lowerFacing,
                blankAbove,
                blankBelow,
                removed: segment,
            },
            options,
        );
        // A delete renumbers nothing: an ordered item that would start a list right under the list line above it
        // keeps a blank line between them, unless it is quoted (a blank line would split the quote) or nested under
        // that line. A move renumbers it from 1, which repairs it unless it is empty: no number lets an empty item
        // interrupt a line, nested or not, so it keeps a blank line that lay between the two. On either path, so does
        // an empty bullet item that would start a list right under the list line, when that blank line lay outside
        // the removed blocks.
        const blanks = Array.from({ length: lower - upper - 1 }, (_, i) => upper + 1 + i).filter(
            (n) => lineMap.lineMeta[n].isEmpty,
        );
        const blankBetween = blanks.length > 0;
        const blankOutsideBlocks = blanks.some((n) =>
            options.blocks.every((block) => n < block.lines.startLine || n > block.lines.endLine),
        );
        const parse = (text: string) => parseLine(text, options.tabSize);
        const startsOrderedList =
            (options.renumbers
                ? lowerFacing.line.body.trim().length === 0 && blankBetween
                : lowerFacing.line.indent.width <= upperFacing.line.indent.width) &&
            startsListUnderList(doc, upper, lowerFacing.line, parse);
        const startsBulletList =
            blankOutsideBlocks && startsEmptyBulletListUnderList(doc, upper, lowerFacing.line, parse);
        const keepsApart = lowerFacing.line.quote.depth === 0 && (startsOrderedList || startsBulletList);
        const kept = collapsed === 0 && keepsApart ? 1 : collapsed;
        if (kept === 1 && blankAbove === 0 && blankBelow === 0) {
            // Keep one terminator, so an empty line remains.
            return deleteRange(line(startLine).from, line(endLine).to);
        }
        // `kept` is one side's blank lines (or 0): delete the other side's with the segment.
        const keepBelow = kept === blankBelow;
        const from = keepBelow ? startLine - blankAbove : startLine;
        const to = keepBelow ? endLine : endLine + blankBelow;
        return deleteRange(line(from).from, line(to + 1).from);
    }
    if (lower > 0) return deleteRange(line(startLine).from, line(lower).from);
    if (upper > 0) {
        return endLine < doc.lines
            ? deleteRange(line(upper + 1).from, line(endLine + 1).from)
            : deleteRange(line(upper).to, doc.length);
    }
    if (endLine < doc.lines) return deleteRange(line(startLine).from, line(endLine + 1).from);
    return startLine > 1 ? deleteRange(line(startLine - 1).to, doc.length) : deleteRange(0, doc.length);
}

function deleteRange(from: number, to: number): TextChange {
    return { from, to, insert: '' };
}

/**
 * Blank lines left between U and L once the lines between them (`removed`
 * and its blank lines) are gone: the larger of the two gaps; for two tight
 * gaps, one blank line where U and L would not stay apart, or where they are
 * lines of one paragraph or quote kind that something else separated.
 * Removing from inside a callout keeps it whole: a blank line would end it,
 * and removing lines of a list item's own paragraph keeps the rest of it
 * joined to the item line.
 */
export function collapsedBlankLines(
    doc: Doc,
    hole: { upper: Facing; lower: Facing; blankAbove: number; blankBelow: number; removed: LineRange },
    options: SpacingContext,
): number {
    const { blankAbove, blankBelow, removed } = hole;
    const upper = removed.startLine - 1 - blankAbove;
    const lower = removed.endLine + 1 + blankBelow;
    const inList = runKind(doc, upper, options) === 'list' && runKind(doc, lower, options) === 'list';
    if (blankAbove !== blankBelow && inList) {
        // Inside a list the gap that remains is a list boundary: it keeps the blank lines of the original boundary
        // of its kind (a parent before its first child, a subtree's end before the next item), so no list turns
        // loose or tight. Between siblings either side is one, and the larger stays.
        const { lineMap } = options;
        const kind = listBoundary(lineMap, upper, lower);
        const above = kind === listBoundary(lineMap, upper, removed.startLine);
        const below = kind === listBoundary(lineMap, removed.endLine, lower);
        if (above !== below) return above ? blankAbove : blankBelow;
    }
    if (blankAbove > 0 || blankBelow > 0) return Math.max(blankAbove, blankBelow);
    if (calloutCovers(doc, upper, lower, options)) return 0;
    // Two quoted lines written together are one quote: lines of two quotes stay apart.
    const quoted = hole.upper.line.quote.depth > 0 && hole.lower.line.quote.depth > 0;
    if (quoted && quoteRunAt(options.lineMap, upper).endLine < lower) return 1;
    // A quote line without text (`>`) already keeps the blocks of its quote apart: a blank line would split it.
    if (quoted && [hole.upper, hole.lower].some((f) => f.line.marker === null && f.line.body.trim().length === 0)) {
        return 0;
    }
    // Lines removed from a list item's own paragraph: the item line and the rest of its paragraph stay one.
    const ownParagraph = (line: number) =>
        options.lineMap.lineMeta[line].indentWidth > hole.upper.line.indent.width &&
        detectBlock(doc, line, options)?.type === BlockType.Paragraph;
    const removedLines = Array.from(
        { length: removed.endLine - removed.startLine + 1 },
        (_, i) => removed.startLine + i,
    );
    if (hole.upper.type === BlockType.ListItem && [lower, ...removedLines].every(ownParagraph)) return 0;
    if (needsBlankLine(hole.upper, hole.lower)) return 1;
    const run = runKind(doc, upper, options);
    if (run === null || run === 'list' || run !== runKind(doc, lower, options)) return 0;
    for (let line = removed.startLine; line <= removed.endLine; line++) {
        if (options.lineMap.lineMeta[line].isEmpty || runKind(doc, line, options) !== run) return 1;
    }
    return 0;
}

/**
 * The kind of list boundary between two lines: the deepest list item whose
 * subtree holds both (0 for none), and whether `upper` is that item's own line
 * (a parent before a child) or not (siblings, or a subtree's end before the
 * next item).
 */
function listBoundary(lineMap: LineMap, upper: number, lower: number): string {
    let item = lineMap.lineMeta[upper].isList ? upper : lineMap.prevListLine[upper];
    while (item > 0 && lineMap.listSubtreeEndLine[item] < lower) item = lineMap.listParentLine[item];
    return `${item}:${item === upper}`;
}

/** Two ordered list lines of one renumbered run: the same indent and quote depth. */
export function continuesOrderedRun(head: ParsedLine, line: ParsedLine): boolean {
    const isOrdered = (p: ParsedLine) => p.marker?.kind === 'list' && p.marker.markerType === 'ordered';
    return (
        isOrdered(head) &&
        isOrdered(line) &&
        head.indent.width === line.indent.width &&
        head.quote.depth === line.quote.depth
    );
}

/**
 * True when the ordered item `item`, written directly under line `above` of `doc`, starts a list under a list line.
 * Outside an ordered list only a non-empty list starting at 1 can interrupt the line above: CodeMirror's parser
 * reads any other item there as text of that line, and CommonMark does when the item is nested under it.
 */
export function startsListUnderList(
    doc: Doc,
    above: number,
    item: ParsedLine,
    parse: (line: string) => ParsedLine,
): boolean {
    if (above < 1) return false;
    if (listMarkerType(item) !== 'ordered') return false;
    if (Number.parseInt(listMarkerText(item), 10) === 1 && item.body.trim().length > 0) return false;
    if (!isListLine(parse(doc.line(above).text))) return false;
    // Lines indented past the item belong to an item above it: the first line at its indent or less decides
    // whether it continues an ordered list.
    for (let n = above; n >= 1; n--) {
        const text = doc.line(n).text;
        if (text.trim().length === 0) continue;
        const line = parse(text);
        if (line.quote.depth !== item.quote.depth) return false;
        if (line.indent.width > item.indent.width) continue;
        return !continuesOrderedRun(line, item);
    }
    return true;
}

/**
 * True when the empty bullet item `item`, written directly under list line `above` of `doc`, starts a list there
 * rather than continuing one. No empty item can interrupt the line above, so it joins that line as text or a heading
 * underline: for CodeMirror's parser outside a bullet list, and for CommonMark when it is nested under the line.
 */
function startsEmptyBulletListUnderList(
    doc: Doc,
    above: number,
    item: ParsedLine,
    parse: (line: string) => ParsedLine,
): boolean {
    // A task's checkbox is content.
    if (listMarkerType(item) !== 'unordered' || item.body.trim().length > 0) return false;
    if (!isListLine(parse(doc.line(above).text))) return false;
    // Lines indented past the item belong to an item above it: the first line at its indent or less decides
    // whether it continues a bullet list.
    for (let n = above; n >= 1; n--) {
        const text = doc.line(n).text;
        if (text.trim().length === 0) continue;
        const line = parse(text);
        if (line.quote.depth !== item.quote.depth) return true;
        if (line.indent.width > item.indent.width) continue;
        const type = listMarkerType(line);
        return line.indent.width < item.indent.width || (type !== 'unordered' && type !== 'task');
    }
    return true;
}

/** An ordered item as the move's renumbering leaves the head of its run: numbered 1. */
function asRunHead(facing: Facing): Facing {
    const { marker } = facing.line;
    if (marker?.kind !== 'list') return facing;
    return { ...facing, line: { ...facing.line, marker: { ...marker, text: '1. ' } } };
}

/**
 * First list line's indent (and quote depth) in a multi-line source blob; with `byLead`, a quoted one's
 * whitespace before its `>`.
 */
function getSourceListBase(
    lines: string[],
    parse: (line: string) => ParsedLine,
    tabSize: number,
    byLead: boolean,
): { indentWidth: number; indentRaw: string; quoteDepth: number } | null {
    for (const line of lines) {
        const parsed = parse(line);
        if (isListLine(parsed)) {
            const { prefix, depth } = parsed.quote;
            if (byLead && depth > 0) {
                const lead = prefix.slice(0, prefix.length - prefix.trimStart().length);
                return { indentWidth: indentWidth(lead, tabSize), indentRaw: lead, quoteDepth: 0 };
            }
            return { indentWidth: parsed.indent.width, indentRaw: parsed.indent.raw, quoteDepth: depth };
        }
    }
    return null;
}

/**
 * Shift every list line (and deeper continuations) so the root list indent
 * becomes targetIndentWidth. Structure-driven: caller supplies target from
 * dropIndentWidth(position); no scanning nearby doc lines for "context".
 * Quoted children of an unquoted list shift the whitespace before their `>`.
 */
export function relevelListText(params: {
    sourceContent: string;
    parse: (line: string) => ParsedLine;
    formatIndentFn: (sample: string, width: number) => string;
    targetIndentWidth: number;
    tabSize: number;
    /** Level a quoted list by the whitespace before its `>`. */
    byLead: boolean;
}): string {
    const { sourceContent, parse, formatIndentFn, targetIndentWidth, tabSize, byLead } = params;
    const lines = sourceContent.split('\n');
    const sourceBase = getSourceListBase(lines, parse, tabSize, byLead);
    if (!sourceBase) return sourceContent;

    const delta = targetIndentWidth - sourceBase.indentWidth;
    if (delta === 0) return sourceContent;

    return lines
        .map((line) => {
            if (line.trim().length === 0) return line;
            const parsed = parse(line);

            if (sourceBase.quoteDepth === 0 && parsed.quote.depth > 0) {
                const prefix = parsed.quote.prefix;
                const leadRaw = prefix.slice(0, prefix.length - prefix.trimStart().length);
                const leadWidth = indentWidth(leadRaw, tabSize);
                if (leadWidth < sourceBase.indentWidth) return line;
                const newLead = formatIndentFn(sourceBase.indentRaw, Math.max(0, leadWidth + delta));
                return `${newLead}${line.slice(leadRaw.length)}`;
            }

            if (!isListLine(parsed) && parsed.indent.width < sourceBase.indentWidth) return line;
            const newIndent = formatIndentFn(sourceBase.indentRaw, Math.max(0, parsed.indent.width + delta));
            // The line's own text after its indent: a list marker, fence, table row, heading, rule or body.
            return `${parsed.quote.prefix}${newIndent}${line.slice(parsed.quote.prefix.length + parsed.indent.raw.length)}`;
        })
        .join('\n');
}

/**
 * A payload of paragraphs, headings and plain quotes as list items at the
 * root, each line with text one item taking `linePrefix` (listConversion),
 * with no blank line between the items.
 */
function asListItems(text: string, linePrefix: string, tabSize: number): string {
    const lines = text
        .split('\n')
        .map((line) => itemText(line, tabSize))
        .filter((body) => body.trim().length > 0)
        .map((body) => ({ indentRaw: '', body }));
    return formatBlockContent(lines, { template: '${content}', linePrefix });
}

/**
 * Text to insert for a move: the payload as list items taking the `asItems`
 * line prefix when it drops into a list (listConversion), then relevel list indent from
 * DropPosition.parent only. Separators are the write step's (insertIntoGap),
 * not part of the text.
 */
export function insertTextForMove(params: {
    /** The selected blocks, in order. */
    blocks: Block[];
    sourceContent: string;
    /** Offsets in sourceContent where each of `blocks` starts. */
    starts: number[];
    position: DropPosition;
    asItems: string | null;
    tabSize: number;
    indentUnit: number;
}): string {
    const { blocks, sourceContent, starts, position, asItems, tabSize, indentUnit } = params;
    const parse = (line: string) => parseLine(line, tabSize);
    const targetIndentWidth = dropIndentWidth(position, { tabSize, indentUnit });
    const relevel = (text: string, width: number, byLead: boolean) =>
        relevelListText({
            sourceContent: text,
            parse,
            formatIndentFn: (sample, w) => formatIndent(w, tabSize, sample),
            targetIndentWidth: width,
            tabSize,
            byLead,
        });
    if (asItems) return relevel(asListItems(sourceContent, asItems, tabSize), targetIndentWidth, false);

    // Structure only: parent list → target indent from dropIndentWidth(parent).
    // No getListContextNearLine / listSampleLine side channel.
    const parent = position.parent?.type === BlockType.ListItem ? position.parent : null;
    // Every selected block lands at the target level. A list item of the parent's quote depth is re-levelled from its
    // own first line. Any other item lands as it would at the root (a quoted one also loses the whitespace before its
    // `>`) and is then nested as a whole, as another block is: the engine writes no `>` prefix, so the whitespace after
    // the parent's own `>` markers grows until the first line is at the target width, and a block or line outside the
    // parent's quote stays as it is (as every block does at the root).
    const depth = (line: string) => parseLine(line, tabSize).quote.depth;
    const parentDepth = parent ? depth(position.doc.line(parent.lines.startLine).text) : 0;
    const outer = (line: string) =>
        (parseLine(line, tabSize).quote.prefix.match(/\s*> ?/g) ?? []).slice(0, parentDepth).join('');
    const nest = (text: string) => {
        const first = text.split('\n', 1)[0];
        if (depth(first) < parentDepth) return text;
        const own = first.slice(outer(first).length);
        const indent = formatIndent(
            targetIndentWidth - indentWidth(own.slice(0, own.length - own.trimStart().length), tabSize),
            tabSize,
        );
        return text
            .split('\n')
            .map((line) => {
                if (line.trim().length === 0 || depth(line) < parentDepth) return line;
                const prefix = outer(line);
                return prefix + indent + line.slice(prefix.length);
            })
            .join('\n');
    };
    const land = (block: Block, text: string) => {
        if (block.type !== BlockType.ListItem) return nest(text);
        if (parent && depth(text.split('\n', 1)[0]) === parentDepth) return relevel(text, targetIndentWidth, false);
        return nest(relevel(relevel(text, 0, true), 0, false));
    };
    const ends = [...starts.slice(1), sourceContent.length];
    return blocks.map((block, i) => land(block, sourceContent.slice(starts[i], ends[i]))).join('');
}
