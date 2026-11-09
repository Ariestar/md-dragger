import { detectBlock } from '../block/block-detector';
import { type Block, BlockType } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import type { Gap } from '../markdown/gap';
import { type LineMap, listItemContaining, quoteRunAt } from '../markdown/line-map';
import type { LineRange } from '../markdown/line-range-types';
import { parseLine } from '../parse/parse-line';

export type DropDecision =
    | { allowDrop: true }
    | { allowDrop: false; rejectReason: 'inside_list' | 'inside_quote_run'; region: LineRange };

/** Blocks a list takes: list items, and the blocks a drop into a list turns into list items (see `listConversion`). */
export const ADAPTABLE_BLOCKS: ReadonlySet<BlockType> = new Set([
    BlockType.Paragraph,
    BlockType.Heading,
    BlockType.ListItem,
    BlockType.Blockquote,
]);

/**
 * The text a payload line keeps as a list item: without its heading marker,
 * quote prefix or indent. Text that itself starts with a list marker stays as
 * it is, so it nests a list in the item. Empty for a bare `>` or an empty
 * heading, which become no item.
 */
export function itemText(line: string, tabSize: number): string {
    const parsed = parseLine(line, tabSize);
    if (parsed.marker?.kind === 'heading') return parsed.body;
    return `${parsed.marker?.text ?? ''}${parsed.body}`;
}

/**
 * Whether a drop into a list turns the payload into list items: every block is
 * a paragraph, heading or plain quote, and some line has text.
 */
export function convertsToItems(payload: { blocks: readonly Block[]; content: string }, tabSize: number): boolean {
    return (
        payload.blocks.every((block) => block.type !== BlockType.ListItem && ADAPTABLE_BLOCKS.has(block.type)) &&
        payload.content.split('\n').some((line) => itemText(line, tabSize).trim().length > 0)
    );
}

/**
 * The line prefix (a `formatBlockContent` linePrefix) a payload's lines take
 * as list items where it drops, or null where it moves as it is. Only a
 * payload convertsToItems accepts converts, and only into an unquoted list:
 * under a list parent, or at the root inside an item's subtree or between two
 * unquoted list lines with no blank line, where it lands as an item of the
 * root list. It takes the marker of the list it joins (bullet character and
 * checkbox; an ordered list's numbers are renumbered): the parent's child
 * next to the gap (the parent's own when it has none), or that root item. A
 * seam inside a tight quote run converts nothing: the quote keeps its lines.
 */
export function listConversion(
    payload: { blocks: readonly Block[]; content: string },
    gap: Gap,
    parent: Block | null,
    options: { lineMap: LineMap; tabSize: number },
): string | null {
    const { lineMap, tabSize } = options;
    if (!convertsToItems(payload, tabSize)) return null;
    const { lineMeta } = lineMap;
    const aboveLine = gap.above ? gap.seam - gap.blankLines - 1 : 0;
    const between = aboveLine > 0 && gap.below !== null && gap.blankLines === 0;
    if (between && lineMeta[aboveLine].quoteDepth > 0 && lineMeta[gap.seam].quoteDepth > 0) return null;

    let head: number | null = null;
    if (parent?.type === BlockType.ListItem) {
        const parentLine = parent.lines.startLine;
        const child = (line: number) => (line > 0 ? listItemContaining(lineMap, line, parentLine) : null);
        const below = gap.below !== null && child(gap.seam) === gap.seam ? gap.seam : null;
        head = child(aboveLine) ?? below ?? parentLine;
    } else if (aboveLine > 0 && gap.below) {
        const item = listItemContaining(lineMap, aboveLine, 0);
        const inSubtree = item !== null && lineMap.listSubtreeEndLine[item] >= gap.seam;
        const intoList = between && lineMeta[gap.seam].isList && lineMeta[gap.seam].quoteDepth === 0;
        if (inSubtree || intoList) head = item;
    }
    if (head === null || lineMeta[head].quoteDepth > 0) return null;
    const { marker } = parseLine(lineMap.doc.line(head).text, tabSize);
    if (marker?.kind !== 'list') throw new Error(`md-dragger: list line ${head} has no list marker`);
    // An ordered list's numbers, and its delimiter, are the renumbering's.
    if (marker.markerType === 'ordered') return '${ordinal}. ';
    const bullet = marker.text.trimStart()[0];
    return marker.markerType === 'task' ? `${bullet} [ ] ` : `${bullet} `;
}

/**
 * Container rules for a gap of the document `lineMap` describes, over every
 * top-level selected block of the payload (read in `sourceDoc`):
 *   - an unquoted list item's subtree accepts only unquoted list items, and
 *     a payload it turns into list items (a list inside a quote is that quote
 *     run's interior);
 *   - a tight quote run (every seam inside a callout, inside a plain quote,
 *     and around quoted lists) accepts only one stack of plain quote lines of
 *     its own depth, between two plain quote lines outside any callout.
 * A gap must pass both; every other gap accepts every block. A rejection
 * carries the protected region, whose edges are where the drop can go
 * instead: the list rule comes first, so a seam in a quote run inside a list
 * item reports the item, whose edges leave it.
 */
export function canDropAt(
    payload: { blocks: readonly Block[]; content: string },
    gap: Gap,
    options: { lineMap: LineMap; tabSize: number; sourceDoc: Doc },
): DropDecision {
    if (!gap.above || !gap.below) return { allowDrop: true };
    const { lineMap, tabSize, sourceDoc } = options;
    const { blocks } = payload;
    const aboveLine = gap.seam - gap.blankLines - 1;
    const quoteDepth = (block: Block) => parseLine(sourceDoc.line(block.lines.startLine).text, tabSize).quote.depth;

    const item = listItemContaining(lineMap, aboveLine, 0);
    if (
        item !== null &&
        lineMap.lineMeta[item].quoteDepth === 0 &&
        lineMap.listSubtreeEndLine[item] >= gap.seam &&
        !blocks.every((block) => block.type === BlockType.ListItem && quoteDepth(block) === 0) &&
        listConversion(payload, gap, null, { lineMap, tabSize }) === null
    ) {
        return {
            allowDrop: false,
            rejectReason: 'inside_list',
            region: { startLine: item, endLine: lineMap.listSubtreeEndLine[item] },
        };
    }

    const depth = lineMap.lineMeta[aboveLine].quoteDepth;
    if (gap.blankLines === 0 && depth > 0 && lineMap.lineMeta[gap.seam].quoteDepth > 0) {
        const joinsRun =
            gap.above.type === BlockType.Blockquote &&
            gap.below.type === BlockType.Blockquote &&
            lineMap.lineMeta[gap.seam].quoteDepth === depth &&
            !calloutCovers(lineMap.doc, aboveLine, gap.seam, { lineMap, tabSize }) &&
            !payload.content.split('\n').some((line) => line.trim().length === 0) &&
            blocks.every((block) => block.type === BlockType.Blockquote && quoteDepth(block) === depth);
        if (!joinsRun) {
            return { allowDrop: false, rejectReason: 'inside_quote_run', region: quoteRunAt(lineMap, aboveLine) };
        }
    }
    return { allowDrop: true };
}

/** Whether one callout, starting at or above `top`, reaches down to `bottom`. */
export function calloutCovers(
    doc: Doc,
    top: number,
    bottom: number,
    options: { lineMap: LineMap; tabSize: number },
): boolean {
    const { lineMeta } = options.lineMap;
    for (let line = top; line >= 1 && lineMeta[line].quoteDepth > 0; line--) {
        if (!lineMeta[line].isCallout) continue;
        const callout = detectBlock(doc, line, options);
        if (callout?.type === BlockType.Callout && callout.lines.endLine >= bottom) return true;
    }
    return false;
}
