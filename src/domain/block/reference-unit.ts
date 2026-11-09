import type { Doc } from '../markdown/document-types';
import { findFencedBlock } from '../markdown/fence-scanner';
import { getLineMap, innermostListItem, type LineMap, quoteRunAt } from '../markdown/line-map';
import type { LineRange } from '../markdown/line-range-types';
import { parseLine } from '../parse/parse-line';
import type { ParsedLine } from '../parse/types';
import { detectBlock, frontmatterEndLine } from './block-detector';
import { isHorizontalRuleLine, isSingleLineFence } from './block-guards';
import { type Block, BlockType } from './block-types';

/** The block a block reference to a line names, and the pieces of text of its own. */
export type ReferenceUnit = {
    /**
     * The block: a list item, through its child items, the lazy continuation lines of its last paragraph and the
     * blocks Obsidian takes into it below the line map's end (`foldOf`); a whole quote or callout, with the unquoted
     * lines it takes in; a whole paragraph; a heading, through a setext underline; or any other block (a table, fenced
     * or indented code, math, a comment, a rule).
     */
    block: Block;
    /**
     * Each paragraph, heading and table of the block's own text, in document order, by the lines that hold its text (a
     * setext underline holds none). A paragraph's or list item's comes first and starts on its first line; a list
     * item's child items' text is theirs. A callout's title line is a paragraph of its own.
     */
    text: Block[];
};

/**
 * The block a block reference to `line` names, or null where there is none or md-dragger cannot tell. A reference can
 * name a top-level block or a list item of a top-level list, at any depth. So a line inside a top-level list (also in a
 * quote under one of its items) gives the innermost list item holding it; any other line gives its top-level block: a
 * paragraph's lines the whole paragraph, a top-level quote's or callout's lines (a list inside it too) the whole quote.
 * A line that lazily continues a paragraph goes where that paragraph does.
 *
 * Text is read as Obsidian's metadata parser reads it, where that differs from CommonMark and from the editor's parser
 * (which `needsBlankLine` follows): any bullet item interrupts a paragraph, an empty one too; a setext heading is a
 * single line of text over an unindented `===` or `---`; a table is a row over a delimiter row, and cannot interrupt a
 * paragraph (`isTable`); a top-level quote takes in every unquoted line under it, whatever block it ends with, up to
 * one that ends it (`endsQuote`); and a list's last item takes in the lines right under it, whatever block they start,
 * up to one that ends it (`foldOf`). As in CommonMark, a line indented less than a list item's content is in the item
 * only as a lazy continuation, and indented code and fences inside a quote hold no text.
 *
 * Null for a line outside the note, in frontmatter, or blank outside a fence; for any line of a footnote definition
 * (`inFootnote`); for a bare list marker (`-`), which the line map does not read as a list item, and a block other
 * than a list item or paragraph that Obsidian takes into its item (`inBareItem`); and for a block that a fence
 * md-dragger's fence scanner reads otherwise than Obsidian can change (`fencesAgree`).
 */
export function referenceUnit(doc: Doc, line: number, options: { tabSize: number }): ReferenceUnit | null {
    if (line < 1 || line > doc.lines) return null;
    const lineMap = getLineMap(doc, options);
    const frontmatterEnd = frontmatterEndLine(doc);
    if (line <= frontmatterEnd || (lineMap.lineMeta[line].isEmpty && !findFencedBlock(doc, line))) return null;
    const scan: Scan = {
        doc,
        lineMap,
        tabSize: options.tabSize,
        frontmatterEnd,
        parsed: [],
        starts: new Int32Array(doc.lines + 2).fill(UNKNOWN),
        inQuotedFence: new Uint8Array(doc.lines + 2),
        folds: new Int32Array(doc.lines + 2),
        ownEnds: new Map(),
    };
    const unit = unitAt(scan, line);
    if (!unit || !fencesAgree(scan, unit)) return null;
    // A paragraph's own text holds an id Obsidian reads as the bare item's.
    const named = unit.block.type === BlockType.ListItem || unit.block.type === BlockType.Paragraph;
    return named || !inBareItem(scan, unit.block.lines.startLine) ? unit : null;
}

/** Lines read once per call, each on demand, so a call is linear in the lines it reads. */
type Scan = {
    doc: Doc;
    lineMap: LineMap;
    tabSize: number;
    frontmatterEnd: number;
    parsed: ParsedLine[];
    /** Per line: the first line of the piece of text that holds its text, NONE, or UNKNOWN until read. */
    starts: Int32Array;
    /** Per line, once read: 1 while a fence opened inside a quote is open after it. */
    inQuotedFence: Uint8Array;
    /** Per line, once read: the list item Obsidian takes it into below the line map's end (`foldOf`), or 0. */
    folds: Int32Array;
    /** Per list item: its last line before a line that ends it (`ownEnd`). */
    ownEnds: Map<number, number>;
};

const UNKNOWN = -1;
const NONE = 0;

const BARE_LIST_MARKER = /^(?:[-*+]|\d+[.)])$/;
const SETEXT_UNDERLINE = /^(?:=+|-+)$/;
const FOOTNOTE_DEFINITION = /^ {0,3}\[\^[^\]]+\]:/;
/** A list item's line, or a heading's, a code fence's or a comment fence's in Obsidian (`endsLazily`). */
const LAZY_END = /^[ \t]*(?:(?:[-*+]|\d+[.)])(?:[ \t]|$)|#{1,6}(?:[ \t]|$)|`{3,}[^`]*$|~{3,}|%%[^%]*$)/;
/** A table's delimiter row: cells of `-` and `:` between pipes, none empty. */
const TABLE_DELIMITER = /^[ \t]*\|?(?:[ \t]*[-:][-: \t]*\|)*(?:[ \t]*[-:][-: \t]*)?$/;

function unitAt(scan: Scan, line: number): ReferenceUnit | null {
    const { lineMeta } = scan.lineMap;
    if (inFootnote(scan, line)) return null;
    const piece = pieceStart(scan, line);
    const start = piece === NONE ? line : piece;

    // A top-level quote takes in the unquoted lines under it, whatever the line map makes of them.
    const lazyQuote = lineMeta[start].quoteDepth === 0 ? lazyQuoteAbove(scan, start) : 0;
    if (lazyQuote > 0) return quoteUnit(scan, lazyQuote);
    const item = itemAt(scan, line);
    if (item > 0 && inTopList(scan, item)) {
        const lines = { startLine: item, endLine: itemEnd(scan, item) };
        return { block: { type: BlockType.ListItem, lines }, text: textIn(scan, lines, item) };
    }
    // A `>` line inside a fence is code.
    if (lineMeta[start].quoteDepth > 0 && !findFencedBlock(scan.doc, start)) return quoteUnit(scan, start);
    if (piece !== NONE) {
        const text = pieceAt(scan, piece);
        if (!setextAt(scan, piece)) return { block: text, text: [text] };
        return { block: { type: BlockType.Heading, lines: { startLine: piece, endLine: piece + 1 } }, text: [text] };
    }
    if (line > 1 && setextAt(scan, line - 1)) {
        return {
            block: { type: BlockType.Heading, lines: { startLine: line - 1, endLine: line } },
            text: [pieceAt(scan, line - 1)],
        };
    }
    // Outside quotes and list items, the only line that can hold text but starts no piece is indented code.
    if (textAt(scan, line)) {
        return { block: { type: BlockType.CodeBlock, lines: indentedCodeAround(scan, line) }, text: [] };
    }
    const block = detectBlock(scan.doc, line, { tabSize: scan.tabSize });
    if (!block || block.type === BlockType.Paragraph) return null;
    return { block, text: [] };
}

/** The top-level quote or callout around quoted line `line`, with its pieces of text. */
function quoteUnit(scan: Scan, line: number): ReferenceUnit {
    const lines = quoteAround(scan, line);
    const type = scan.lineMap.lineMeta[lines.startLine].isCallout ? BlockType.Callout : BlockType.Blockquote;
    return { block: { type, lines }, text: textIn(scan, lines, 0) };
}

function parsed(scan: Scan, n: number): ParsedLine {
    let line = scan.parsed[n];
    if (line === undefined) {
        line = parseLine(scan.doc.line(n).text, scan.tabSize);
        scan.parsed[n] = line;
    }
    return line;
}

/**
 * Whether line `n` can hold text, taken by itself: not when blank or frontmatter, fenced code, math or a comment (one
 * opened and closed on its line is inline text), a rule, a fence line inside a quote, a bare `>`, or a bare list
 * marker. A list item's line holds text even when the item is empty.
 */
function textAt(scan: Scan, n: number): boolean {
    if (n <= scan.frontmatterEnd || scan.lineMap.lineMeta[n].isEmpty) return false;
    const fence = findFencedBlock(scan.doc, n);
    if (fence) return fence.type !== BlockType.CodeBlock && fence.range.startLine === fence.range.endLine;
    const line = parsed(scan, n);
    // A math or comment fence the scanner pairs with none is text, as Obsidian reads it where it opens no fence.
    if (line.marker) return line.marker.kind !== 'hr' && (line.marker.kind !== 'fence' || line.quote.depth === 0);
    return line.body.trim() !== '' && !BARE_LIST_MARKER.test(line.body);
}

/**
 * The first line of the piece of text that holds line `n`'s text, or NONE. Lines are read down from the first unread
 * one, so every line above a line being read is read already.
 */
function pieceStart(scan: Scan, n: number): number {
    if (scan.starts[n] === UNKNOWN) {
        let top = n;
        while (top - 1 > scan.frontmatterEnd && scan.starts[top - 1] === UNKNOWN) top--;
        for (let m = top; m <= n; m++) readLine(scan, m);
    }
    return scan.starts[n];
}

/** Reads line `m` into `scan.starts`, `scan.inQuotedFence` and `scan.folds`. */
function readLine(scan: Scan, m: number): void {
    const above = m - 1 > scan.frontmatterEnd && !scan.lineMap.lineMeta[m - 1].isEmpty;
    const prev = above ? scan.starts[m - 1] : NONE;
    // A line a quote takes in, lazily too, while a fence in it is open is code.
    const fenced =
        above && scan.inQuotedFence[m - 1] === 1 && (scan.lineMap.lineMeta[m].quoteDepth > 0 || !endsQuote(scan, m));
    scan.inQuotedFence[m] = fenced !== isQuotedFence(parsed(scan, m)) ? 1 : 0;
    scan.folds[m] = foldOf(scan, m);

    const underline = above && prev === m - 1 && SETEXT_UNDERLINE.test(scan.doc.line(m).text) && setextText(scan, prev);
    let start = m;
    if (!textAt(scan, m) || fenced || underline) start = NONE;
    else if (prev !== NONE && !isCalloutTitle(scan, prev) && continues(scan, prev, m)) start = prev;
    else if (isIndentedCode(scan, m)) start = NONE;
    scan.starts[m] = start;
}

/** Whether a line opens or closes a code, math or comment fence inside a quote, where the fence scanner reads none. */
function isQuotedFence(line: ParsedLine): boolean {
    const marker = line.marker;
    if (line.quote.depth === 0 || marker?.kind !== 'fence') return false;
    return marker.fence === 'code' || !isSingleLineFence(marker.text, marker.fence === 'math' ? '$$' : '%%');
}

/**
 * Whether line `m`, which holds text, would continue the piece of text that starts on `start` and holds line `m - 1`
 * (a callout's title is a piece of its own all the same). A heading is one line, and a table runs through its rows. A
 * paragraph runs on through lazy continuation lines, but not into a deeper quote, a heading, or a list item that
 * interrupts it: any bullet item, empty or not, an ordered item starting at 1, and any item at the level of the item
 * holding the paragraph, its sibling. (`needsBlankLine` and `startsListUnderList` follow the editor's parser, where no
 * empty item interrupts a paragraph.) A top-level quote's paragraph ends where the quote does (`endsQuote`).
 */
function continues(scan: Scan, start: number, m: number): boolean {
    const top = parsed(scan, start);
    const next = parsed(scan, m);
    if (isTable(scan, start)) {
        return isRow(next) && hasLeadingPipe(next) === hasLeadingPipe(top) && next.quote.depth <= top.quote.depth;
    }
    const text = textOf(scan, start);
    if (text.marker?.kind === 'heading' || next.marker?.kind === 'heading') return false;
    // An item whose line opens a quote (`- > q`) holds its paragraph in that quote.
    const depth = top.quote.depth + (text === top ? 0 : text.quote.depth);
    if (next.quote.depth > depth) return false;
    if (next.marker?.kind === 'list' && isListItem(scan, m)) {
        if (opensList(next)) return false;
        // In a list item, Obsidian reads a list line indented less than the item's content as an item of its own.
        const item = holder(scan, start);
        const quoteDepth = scan.lineMap.lineMeta[item].quoteDepth;
        if (item > 0 && next.quote.depth === quoteDepth && next.indent.width < contentColumn(scan, item)) return false;
    }
    if (next.quote.depth > 0 || !endsQuote(scan, m)) return true;
    // A paragraph of lazy lines under a top-level quote is the quote's too.
    if (top.quote.depth === 0 && lazyQuoteAbove(scan, start) === 0) return true;
    const item = holder(scan, start);
    return item > 0 && inTopList(scan, item);
}

/** Whether a list line is a bullet item or an ordered one starting at 1, which interrupt a paragraph. */
function opensList(line: ParsedLine): boolean {
    const marker = line.marker;
    return marker?.kind === 'list' && (marker.markerType !== 'ordered' || Number.parseInt(marker.text, 10) === 1);
}

/**
 * Whether unquoted line `n` ends a top-level quote above it, which takes in any other line, whatever block the quote
 * ends with: a line of no text, or one that starts indented code, a heading (a setext one too), or a list item that
 * interrupts a paragraph.
 */
function endsQuote(scan: Scan, n: number): boolean {
    if (!textAt(scan, n)) return true;
    const line = parsed(scan, n);
    if (scan.lineMap.lineMeta[n].indentWidth >= 4 || line.marker?.kind === 'heading' || opensList(line)) return true;
    return n < scan.doc.lines && SETEXT_UNDERLINE.test(scan.doc.line(n + 1).text);
}

/**
 * The quoted line above unquoted line `n` whose top-level quote takes `n` in: past the lines between, which end no
 * quote, as `n` does not. 0 when there is none, or the quote is in a list item.
 */
function lazyQuoteAbove(scan: Scan, n: number): number {
    const { lineMeta } = scan.lineMap;
    let line = n;
    for (; lineMeta[line].quoteDepth === 0; line--) {
        if (line === 1 || endsQuote(scan, line)) return 0;
    }
    const item = holder(scan, line);
    return item > 0 && inTopList(scan, item) ? 0 : line;
}

/** Whether list line `m`, once read, starts a list item: not when indented four columns or more with no item above it. */
function isListItem(scan: Scan, m: number): boolean {
    return scan.lineMap.lineMeta[m].indentWidth < 4 || scan.lineMap.listParentLine[m] > 0 || scan.folds[m] > 0;
}

/** Whether line `n` is a callout's title: a callout marker on the line that opens its quote. */
function isCalloutTitle(scan: Scan, n: number): boolean {
    const { lineMeta } = scan.lineMap;
    return lineMeta[n].isCallout && lineMeta[n].quoteDepth > lineMeta[n - 1].quoteDepth;
}

/**
 * Whether line `m`, which holds text and would start a piece, is indented code: four columns in, in no list item, a
 * list line too. An item that reads as indented code holds none, and a quoted item no unquoted line but a lazy one.
 */
function isIndentedCode(scan: Scan, m: number): boolean {
    const { lineMeta, listParentLine, prevNonEmpty } = scan.lineMap;
    if (lineMeta[m].indentWidth < 4) return false;
    const item = lineMeta[m].isList ? listParentLine[m] : innermostListItem(scan.lineMap, m);
    if (item > 0) {
        return (lineMeta[item].quoteDepth > 0 && lineMeta[m].quoteDepth === 0) || pieceStart(scan, item) === NONE;
    }
    // Past blank lines an unquoted list goes on into an indented line, though the line map ends it at a lazy line.
    const above = prevNonEmpty[m - 1];
    if (above === 0) return true;
    const start = pieceStart(scan, above);
    const held = holder(scan, start === NONE ? above : start);
    return held === 0 || lineMeta[held].quoteDepth > 0;
}

/** Whether line `n`, which starts a piece, takes a setext underline: no heading, outside quotes and list items. */
function setextText(scan: Scan, n: number): boolean {
    const heading = parsed(scan, n).marker?.kind === 'heading';
    return !heading && scan.lineMap.lineMeta[n].quoteDepth === 0 && holder(scan, n) === 0;
}

/** Whether a setext underline makes the piece starting on line `n` a heading. */
function setextAt(scan: Scan, n: number): boolean {
    const underline = n < scan.doc.lines && SETEXT_UNDERLINE.test(scan.doc.line(n + 1).text);
    return underline && pieceStart(scan, n) === n && setextText(scan, n);
}

/** The last line of the piece of text that starts on `start`. */
function pieceEnd(scan: Scan, start: number): number {
    let end = start;
    while (end < scan.doc.lines && pieceStart(scan, end + 1) === start) end++;
    return end;
}

/** The piece of text that starts on line `start`: a heading, a table, or a paragraph (a callout's title too). */
function pieceAt(scan: Scan, start: number): Block {
    let type = BlockType.Paragraph;
    if (textOf(scan, start).marker?.kind === 'heading' || setextAt(scan, start)) type = BlockType.Heading;
    else if (isTable(scan, start)) type = BlockType.Table;
    return { type, lines: { startLine: start, endLine: pieceEnd(scan, start) } };
}

/** Line `n` parsed as the text it holds: a list item's line by its text after the marker (`- # H`, `- > q`). */
function textOf(scan: Scan, n: number): ParsedLine {
    const line = parsed(scan, n);
    return line.marker?.kind === 'list' ? parseLine(line.body, scan.tabSize) : line;
}

/**
 * Whether the piece of text that starts on line `n` is a table, as Obsidian reads one: a row (a line with a `|` after
 * its first character) over a delimiter row, each with a leading pipe or neither, the cell counts aside. Its rows run
 * on while they keep the first row's leading pipe or its lack, which an indent breaks too (`continues`).
 */
function isTable(scan: Scan, n: number): boolean {
    if (n === scan.doc.lines) return false;
    const head = parsed(scan, n);
    const delimiter = parsed(scan, n + 1);
    const text = rowText(delimiter);
    if (!isRow(head) || !isRow(delimiter) || !/[-:]/.test(text)) return false;
    return TABLE_DELIMITER.test(text) && hasLeadingPipe(head) === hasLeadingPipe(delimiter);
}

/** A line's text in its quote. */
function rowText(line: ParsedLine): string {
    return line.raw.slice(line.quote.prefix.length);
}

function isRow(line: ParsedLine): boolean {
    return rowText(line).indexOf('|', 1) > 0;
}

function hasLeadingPipe(line: ParsedLine): boolean {
    return rowText(line).startsWith('|');
}

/** The pieces of text within `lines`, without the lines of `item`'s child items (`item` 0 for no item). */
function textIn(scan: Scan, lines: LineRange, item: number): Block[] {
    const { lineMeta } = scan.lineMap;
    const text: Block[] = [];
    for (let n = lines.startLine; n <= lines.endLine; n++) {
        if (item > 0 && lineMeta[n].isList && parentOf(scan, n) === item) {
            n = itemEnd(scan, n);
        } else if (pieceStart(scan, n) === n) {
            const piece = pieceAt(scan, n);
            text.push(piece);
            n = piece.lines.endLine;
        }
    }
    return text;
}

/** The innermost list item that holds line `n`, or 0: the line map's, or the one Obsidian takes it into (`foldOf`). */
function holder(scan: Scan, n: number): number {
    const item = mapHolder(scan, n);
    if (item > 0) return item;
    pieceStart(scan, n); // reads line n, with its fold
    return scan.folds[n];
}

/** The innermost list item of the line map that holds line `n`, or 0: the nearest one above it that `n` is in. */
function mapHolder(scan: Scan, n: number): number {
    let item = innermostListItem(scan.lineMap, n);
    while (item > 0 && ownEnd(scan, item) < n) item = scan.lineMap.listParentLine[item];
    return item;
}

/**
 * The innermost list item that holds the piece of text on line `n`, or the line, or 0. A list line that starts no
 * piece is no item: an ordered item that cannot interrupt the paragraph above it, or one indented as code.
 */
function itemAt(scan: Scan, n: number): number {
    const start = pieceStart(scan, n);
    let item = holder(scan, start === NONE ? n : start);
    while (item > 0 && pieceStart(scan, item) !== item) item = parentOf(scan, item);
    return item;
}

/**
 * The list item Obsidian nests list item `x` in, or 0: its parent in the line map, past items that end above it
 * (`ownEnd`), or the item Obsidian takes it into below the line map's end (`foldOf`).
 */
function parentOf(scan: Scan, x: number): number {
    let parent = scan.lineMap.listParentLine[x];
    while (parent > 0 && ownEnd(scan, parent) < x) parent = scan.lineMap.listParentLine[parent];
    if (parent > 0) return parent;
    pieceStart(scan, x); // reads line x, with its fold
    return scan.folds[x];
}

/**
 * The item of an unquoted top-level list that Obsidian's list parser takes line `m` into where the line map has ended
 * that list above it, or 0: for a line the line map holds in no item, or a list line it reads as a list of its own.
 * Obsidian takes a line indented to the content of an item above it into the innermost such item; a line right under
 * the list into its innermost item, whatever block that line starts (a quote, a callout, a math fence), unless no item
 * takes it in lazily (`endsLazily`); and past blank lines, only a line more than four columns in.
 */
function foldOf(scan: Scan, m: number): number {
    const { lineMeta, listParentLine, prevNonEmpty } = scan.lineMap;
    const above = prevNonEmpty[m - 1];
    if (lineMeta[m].isEmpty || above <= scan.frontmatterEnd) return 0;
    if (lineMeta[m].isList ? listParentLine[m] > 0 : mapHolder(scan, m) > 0) return 0;
    const item = itemAt(scan, above);
    if (item === 0 || !inTopList(scan, item)) return 0;
    const width = lineMeta[m].leadWidth;
    let root = item;
    for (let x = item; x > 0; x = parentOf(scan, x)) {
        if (lineMeta[x].quoteDepth === 0 && contentColumn(scan, x) <= width) return x;
        root = x;
    }
    if (above === m - 1 && !endsLazily(scan.doc.line(m).text)) {
        // A quoted line goes on in the quote, which an item holds, not in a quoted item it is not indented into.
        let lazy = item;
        while (lineMeta[m].quoteDepth > 0 && lineMeta[lazy].quoteDepth > 0) lazy = parentOf(scan, lazy);
        return lazy;
    }
    return above !== m - 1 && width > 4 ? root : 0;
}

/** Whether list item `item` is in an unquoted top-level list, as Obsidian nests it (`parentOf`). */
function inTopList(scan: Scan, item: number): boolean {
    let root = item;
    for (let parent = parentOf(scan, root); parent > 0; parent = parentOf(scan, parent)) root = parent;
    return scan.lineMap.lineMeta[root].quoteDepth === 0;
}

/**
 * Whether Obsidian holds line `n` in the item of a bare list marker, which md-dragger cannot name: the lines right
 * under the marker, and past blank lines the indented ones, up to one that ends the item or another list item.
 */
function inBareItem(scan: Scan, n: number): boolean {
    const { lineMeta, prevNonEmpty } = scan.lineMap;
    for (let line = n; line > 1; ) {
        const above = prevNonEmpty[line - 1];
        const lazy = above === line - 1 && !endsLazily(scan.doc.line(line).text);
        if (above === 0 || !(lazy || (above < line - 1 && lineMeta[line].leadWidth > 0))) return false;
        if (isBareMarker(scan, above)) return true;
        if (lineMeta[above].isList) return false;
        line = above;
    }
    return false;
}

/**
 * Whether line `n` is a bare list marker (`-`, `1.`): an empty item to Obsidian, which the line map does not read;
 * not a setext underline.
 */
function isBareMarker(scan: Scan, n: number): boolean {
    const line = n > scan.frontmatterEnd ? parsed(scan, n) : null;
    if (line === null || line.marker || line.quote.depth > 0 || !BARE_LIST_MARKER.test(line.body)) return false;
    return n === 1 || !setextAt(scan, n - 1);
}

/** Whether no list item takes line `text` in lazily in Obsidian: a list item, a rule, a heading, a code or comment fence. */
function endsLazily(text: string): boolean {
    return LAZY_END.test(text) || isHorizontalRuleLine(text);
}

/**
 * A list item's last line in the line map's subtree, before a line that ends it, which then belongs to an item above
 * or to no list: a line indented less than an unquoted item's content that follows a blank line, or that is a list
 * line (a sibling, or a list of its own), a heading, or a code or comment fence. Other such lines right after the
 * item's own go on in it.
 */
function ownEnd(scan: Scan, item: number): number {
    const known = scan.ownEnds.get(item);
    if (known !== undefined) return known;
    const { lineMeta, listParentLine, listSubtreeEndLine } = scan.lineMap;
    // A quoted item's lines are measured inside its quote, as the line map nests them.
    const content = lineMeta[item].quoteDepth > 0 ? 0 : contentColumn(scan, item);
    let end = item;
    for (let n = item + 1; n <= listSubtreeEndLine[item]; n++) {
        if (lineMeta[n].isEmpty) continue;
        const marker = parsed(scan, n).marker;
        const fence = marker?.kind === 'fence' && marker.fence !== 'math';
        const interrupts = marker?.kind === 'list' || marker?.kind === 'heading' || fence;
        if (lineMeta[n].leadWidth < content && (interrupts || lineMeta[n - 1].isEmpty)) break;
        if (lineMeta[n].isList && listParentLine[n] === item) {
            end = ownEnd(scan, n);
            n = end;
        } else {
            end = n;
        }
    }
    scan.ownEnds.set(item, end);
    return end;
}

/** The column an unquoted list item's content starts at: past its marker and the spaces after it. */
function contentColumn(scan: Scan, item: number): number {
    const marker = parsed(scan, item).marker;
    if (marker?.kind !== 'list') throw new Error(`md-dragger: no list marker on list line ${item}`);
    // A task's checkbox is content.
    const width = marker.markerType === 'task' ? 2 : marker.text.length;
    return scan.lineMap.lineMeta[item].indentWidth + width;
}

/**
 * A list item's last line: its own end, or a line below it that continues a piece of text in it lazily, or that
 * Obsidian takes into it or an item under it (`foldOf`).
 */
function itemEnd(scan: Scan, item: number): number {
    const { lineMeta } = scan.lineMap;
    let end = ownEnd(scan, item);
    for (let n = end + 1; n <= scan.doc.lines; n++) {
        if (lineMeta[n].isEmpty) continue;
        const start = pieceStart(scan, n);
        let held = start !== NONE && start <= end ? item : holder(scan, n);
        while (held > 0 && held !== item) held = parentOf(scan, held);
        if (held === 0) break;
        end = n;
    }
    return end;
}

/** The top-level quote around a quoted line: runs of quoted lines (`quoteRunAt`) and the unquoted lines it takes in. */
function quoteAround(scan: Scan, line: number): LineRange {
    const { lineMap } = scan;
    const quoted = (n: number) => lineMap.lineMeta[n].quoteDepth > 0;
    let { startLine, endLine } = quoteRunAt(lineMap, line);
    while (startLine > 1 && !quoted(startLine - 1)) {
        const above = lazyQuoteAbove(scan, startLine - 1);
        if (above === 0) break;
        startLine = quoteRunAt(lineMap, above).startLine;
    }
    while (endLine < scan.doc.lines) {
        const below = endLine + 1;
        if (quoted(below)) endLine = quoteRunAt(lineMap, below).endLine;
        else if (!endsQuote(scan, below)) endLine = below;
        else break;
    }
    return { startLine, endLine };
}

/** The lines of the indented code block around line `line`. */
function indentedCodeAround(scan: Scan, line: number): LineRange {
    const { lineMeta } = scan.lineMap;
    const code = (n: number) => lineMeta[n].indentWidth >= 4 && pieceStart(scan, n) === NONE && textAt(scan, n);
    let startLine = line;
    for (let n = line - 1; n > scan.frontmatterEnd && (lineMeta[n].isEmpty || code(n)); n--) {
        if (!lineMeta[n].isEmpty) startLine = n;
    }
    let endLine = line;
    for (let n = line + 1; n <= scan.doc.lines && (lineMeta[n].isEmpty || code(n)); n++) {
        if (!lineMeta[n].isEmpty) endLine = n;
    }
    return { startLine, endLine };
}

/**
 * Whether line `n` is in a footnote definition, as Obsidian reads one: a piece of text that starts with its label,
 * past blank lines each line indented four columns or more, and the plain lines right under one in it.
 */
function inFootnote(scan: Scan, n: number): boolean {
    const { lineMeta, prevNonEmpty } = scan.lineMap;
    for (let line = n; ; ) {
        const start = pieceStart(scan, line);
        if (start !== NONE && FOOTNOTE_DEFINITION.test(scan.doc.line(start).text)) return true;
        const top = start === NONE ? line : start;
        if (top - 1 <= scan.frontmatterEnd) return false;
        if (lineMeta[top - 1].isEmpty) {
            line = prevNonEmpty[top - 1];
            if (lineMeta[top].leadWidth < 4 || line <= scan.frontmatterEnd) return false;
        } else {
            // A plain line, one-line math or a comment too, goes on lazily in a definition above it.
            const text = parsed(scan, top);
            const plain = !text.marker || (text.marker.kind === 'fence' && textAt(scan, top));
            if (!plain || text.quote.depth > 0) return false;
            line = top - 1;
        }
    }
}

/** A fence Obsidian reads as open: its first line, its marker run, and its list item's content column (0 for none). */
type OpenFence = { start: number; marker: string; size: number; column: number };

/** An opening code fence (a backtick one with no backtick after), tilde, math or comment fence, in Obsidian. */
const OPENER = /^(?:(`{3,})[^`]*|(~{3,}).*|(\$\$+)[^$]*|%%[^%]*)$/;
const CODE_CLOSER = /^(`{3,}|~{3,})[ \t]*$/;
/** A line whose first dollars end it. */
const MATH_CLOSER = /^[^$]*(\$+) *$/;
/** A comment fence that closes inside its line, on which another block starts. */
const SPLIT = -1;

/**
 * Whether md-dragger's fence scanner (`findFencedBlock`) reads the unquoted fences that can change `unit` as Obsidian
 * does: line by line from the top of the note through the unit, its fence's end when it is one, and the line after
 * any other, which it would go on into if Obsidian read it as text. A line both read outside fences that starts at its
 * first column under a blank line, or starts a heading there, ends what the lines above can change: no list, quote,
 * paragraph or indented code goes on across it.
 *
 * Obsidian reads code fences as CommonMark does, tildes too: one closes only on a run of its character as long or
 * longer, with nothing after it, at most three columns into its list item. A math fence closes on a line that ends with
 * at least as many dollars as opened it, the first ones in the line, and a comment fence on the next `%%`. One left
 * open runs on to the end of its list item (`endsItem`), or of the note. Quoted fences, which the scanner does not
 * read, are the quote's (`inQuotedFence`).
 */
function fencesAgree(scan: Scan, unit: ReferenceUnit): boolean {
    const { doc } = scan;
    const { lineMeta } = scan.lineMap;
    const through = unit.block.lines.endLine;
    const fence = findFencedBlock(doc, through);
    const fenced = unit.text.length === 0 && fence?.range.startLine === unit.block.lines.startLine;
    const last = Math.min(fenced ? through : through + 1, doc.lines);
    // Per line Obsidian reads outside fences: 1, or 2 where the scanner reads it otherwise, so that its pieces of text
    // there are not to be trusted. And the content column of the item that takes the next line in lazily.
    const outside = new Uint8Array(last + 1);
    let lazy = 0;
    let open: OpenFence | null = null;
    let agree = true;
    for (let n = 1; n <= last; n++) {
        if (lineMeta[n].isEmpty) continue;
        const text = doc.line(n).text;
        const read = findFencedBlock(doc, n);
        // One-line math and comments are text to md-dragger, as to Obsidian.
        const single = read && read.type !== BlockType.CodeBlock && read.range.startLine === read.range.endLine;
        const scanner = read && !single ? read.range.startLine : 0;
        let obsidian = 0;
        if (open && endsItem(scan, n, open.column)) open = null;
        if (open) {
            obsidian = open.start;
            if (closes(open, text, lineMeta[n].leadWidth)) {
                if (open.marker === '%' && text.slice(text.indexOf('%%') + 2).trim()) obsidian = SPLIT;
                open = null;
            }
        } else if (n > scan.frontmatterEnd) {
            const under = lineMeta[n - 1].isEmpty || endsLazily(text) ? 0 : lazy;
            open = opensFence(scan, n, outside, under);
            obsidian = open ? n : 0;
            outside[n] = obsidian === scanner ? 1 : 2;
            const bare = isBareMarker(scan, n) ? lineMeta[n].leadWidth + parsed(scan, n).body.length + 1 : 0;
            lazy = bare || Math.max(itemColumn(scan, n, outside, Number.POSITIVE_INFINITY), under);
        }
        if (n > through) return agree && !(scanner > 0 && obsidian === 0);
        if (obsidian !== scanner) agree = false;
        else if (
            obsidian === 0 &&
            lineMeta[n].leadWidth === 0 &&
            (lineMeta[n - 1].isEmpty || /^#{1,6}(?:[ \t]|$)/.test(text))
        ) {
            agree = true;
        }
        if (n === through && fenced && open) return false;
    }
    return agree;
}

/**
 * The fence Obsidian opens on unquoted line `n` outside fences, or null: one at most three columns into the content
 * of the list item holding it, or after the markers on a list item's line. A fence that ends an item's lazy lines
 * opens in the innermost item it is indented into; a math fence, which ends none, in the item taking it in lazily
 * (`lazy`, its content column) too, and needs a line after it in its item.
 */
function opensFence(scan: Scan, n: number, outside: Uint8Array, lazy: number): OpenFence | null {
    const { lineMeta } = scan.lineMap;
    const line = parsed(scan, n);
    const onItem = line.marker?.kind === 'list';
    const text = onItem ? line.body.replace(/^(?:(?:[-*+]|\d+[.)])[ \t]+)*/, '') : line.raw.trimStart();
    const match = line.quote.depth === 0 ? OPENER.exec(text) : null;
    if (!match) return null;
    const [, backticks, tildes, dollars] = match;
    let column: number;
    if (onItem) {
        column = contentColumn(scan, n) + line.body.length - text.length;
    } else {
        const width = lineMeta[n].leadWidth;
        column = dollars
            ? Math.max(itemColumn(scan, n, outside, Number.POSITIVE_INFINITY), lazy)
            : itemColumn(scan, n, outside, width);
        if (width - column > 3) return null;
    }
    if (dollars && (n === scan.doc.lines || endsItem(scan, n + 1, column))) return null;
    const run = backticks ?? tildes ?? dollars ?? '%%';
    // A footnote definition takes a comment fence right under it as text.
    if (run === '%%' && !lineMeta[n - 1].isEmpty && inFootnote(scan, n - 1)) return null;
    return { start: n, marker: run[0], size: run.length, column };
}

/**
 * The content column of the innermost unquoted list item of the line map that holds line `n`, with its content at
 * most `width` columns in, or 0: one on a line Obsidian reads outside fences (`outside`), that starts a piece of text
 * there unless the scanner reads the line otherwise.
 */
function itemColumn(scan: Scan, n: number, outside: Uint8Array, width: number): number {
    const { lineMeta, listParentLine } = scan.lineMap;
    const isItem = (item: number) => outside[item] === 2 || (outside[item] === 1 && pieceStart(scan, item) === item);
    let item = mapHolder(scan, n);
    while (item > 0 && (lineMeta[item].quoteDepth > 0 || !isItem(item) || contentColumn(scan, item) > width)) {
        item = listParentLine[item];
    }
    return item > 0 ? contentColumn(scan, item) : 0;
}

/** Whether line `text`, `width` columns in, closes fence `open`. */
function closes(open: OpenFence, text: string, width: number): boolean {
    if (open.marker === '%') return text.includes('%%');
    if (open.marker === '$') return (MATH_CLOSER.exec(text)?.[1].length ?? 0) >= open.size;
    const run = CODE_CLOSER.exec(text.trimStart())?.[1];
    return run !== undefined && run[0] === open.marker && run.length >= open.size && width - open.column <= 3;
}

/**
 * Whether line `m` ends the list item whose content starts at `column`, and a fence in it: a line indented less that
 * follows a blank line, or that no item takes in lazily (`endsLazily`).
 */
function endsItem(scan: Scan, m: number, column: number): boolean {
    const { lineMeta } = scan.lineMap;
    if (lineMeta[m].isEmpty || lineMeta[m].leadWidth >= column) return false;
    return lineMeta[m - 1].isEmpty || endsLazily(scan.doc.line(m).text);
}
