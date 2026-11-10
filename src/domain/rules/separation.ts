import { detectBlock, frontmatterEndLine } from '../block/block-detector';
import { type Block, BlockType } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import { blockAt } from '../markdown/gap';
import { type LineMap, listItemContaining } from '../markdown/line-map';
import type { LineRange } from '../markdown/line-range-types';
import { parseLine } from '../parse/parse-line';
import type { ParsedLine } from '../parse/types';

/** A boundary line that touches the moved payload, with the innermost block there. */
export type Facing = { type: BlockType; line: ParsedLine };

/**
 * How a non-blank line joins the lines next to it: two vertically adjacent
 * lines of one run kind are one paragraph, one quote or one list (outside any quote).
 */
export type RunKind = 'list' | `paragraph@${number}` | `quote@${number}`;

/** Blocks nothing continues: any line may follow them directly. A table ends at the first line not starting with `|`,
 * and a line that does is a table itself. */
const CLOSED = new Set([
    BlockType.Heading,
    BlockType.HorizontalRule,
    BlockType.CodeBlock,
    BlockType.MathBlock,
    BlockType.Table,
]);

/**
 * True when `lower` written directly under `upper` would not stay the same
 * two blocks. The only place that knows Markdown adjacency.
 */
export function needsBlankLine(upper: Facing, lower: Facing): boolean {
    // Obsidian needs a blank line before a table, but none after it.
    if (lower.type === BlockType.Table) return true;
    if (upper.type === lower.type) {
        switch (upper.type) {
            // A list child line followed by a root line would be a lazy continuation.
            case BlockType.Paragraph:
                return upper.line.indent.width !== lower.line.indent.width;
            // A quote or list line of another quote depth would lazily continue the upper one or merge into its quote.
            case BlockType.Blockquote:
            case BlockType.ListItem:
                return upper.line.quote.depth !== lower.line.quote.depth;
        }
    }
    if (CLOSED.has(upper.type)) return false;
    switch (lower.type) {
        case BlockType.Heading:
        case BlockType.CodeBlock:
        case BlockType.MathBlock:
            return false;
        case BlockType.ListItem: {
            // Only an ordered list starting at 1 can interrupt a paragraph, and no empty item (`para\n- ` is a
            // setext heading); a task's checkbox is content.
            const marker = lower.line.marker;
            if (marker?.kind !== 'list') return false;
            if (marker.markerType !== 'task' && lower.line.body.trim().length === 0) return true;
            return marker.markerType === 'ordered' && Number.parseInt(marker.text, 10) !== 1;
        }
        // Under a quoted line (a quote, a callout, or a list item inside one) the two would merge into one quote.
        case BlockType.Blockquote:
        case BlockType.Callout:
            return upper.line.quote.depth > 0;
        default:
            // Lazy continuation and setext (`text\n---`).
            return true;
    }
}

/**
 * A block the user kept apart: a blank line, document edge or frontmatter
 * directly above, and a blank line or document edge directly below. A
 * paragraph or quote line is kept apart when it is a whole paragraph or quote
 * by itself, since lines join only lines of their own run kind: between two
 * headings it stands alone, not as a line of a larger paragraph.
 */
export function isStandalone(doc: Doc, block: Block, options: { lineMap: LineMap }): boolean {
    const { startLine, endLine } = block.lines;
    if (block.type === BlockType.Paragraph || block.type === BlockType.Blockquote) {
        const run = runLines(doc, startLine, { lineMap: options.lineMap, tabSize: options.lineMap.tabSize });
        return run.startLine === startLine && run.endLine === endLine;
    }
    const { lineMeta } = options.lineMap;
    const above = startLine - 1 <= frontmatterEndLine(doc) || lineMeta[startLine - 1].isEmpty;
    const below = endLine >= doc.lines || lineMeta[endLine + 1].isEmpty;
    return above && below;
}

/** The paragraph or quote a non-blank line is part of: the stack of adjacent lines of its run kind. */
export function runLines(doc: Doc, line: number, options: { lineMap: LineMap; tabSize: number }): LineRange {
    const own = runKind(doc, line, options);
    const frontmatterEnd = frontmatterEndLine(doc);
    const joins = (other: number) =>
        other > frontmatterEnd &&
        other <= doc.lines &&
        !options.lineMap.lineMeta[other].isEmpty &&
        runKind(doc, other, options) === own;
    let startLine = line;
    while (joins(startLine - 1)) startLine--;
    let endLine = line;
    while (joins(endLine + 1)) endLine++;
    return { startLine, endLine };
}

/** The facing data of a non-blank line: its text and the innermost block there. */
export function facingAt(doc: Doc, line: number, options: { tabSize: number }): Facing {
    return { type: blockAt(doc, line, options).type, line: parseLine(doc.line(line).text, options.tabSize) };
}

/**
 * Run kind of a non-blank line, or null for lines that join nothing (headings, callouts, fences, …). A list inside
 * a quote belongs to its quote: it has no run kind.
 */
export function runKind(doc: Doc, line: number, options: { lineMap: LineMap; tabSize: number }): RunKind | null {
    const { lineMap } = options;
    const item = listItemContaining(lineMap, line, 0);
    if (item !== null) return lineMap.lineMeta[item].quoteDepth === 0 ? 'list' : null;
    const type = detectBlock(doc, line, options)?.type;
    if (type === BlockType.Paragraph) return `paragraph@${lineMap.lineMeta[line].indentWidth}`;
    if (type === BlockType.Blockquote) return `quote@${lineMap.lineMeta[line].quoteDepth}`;
    return null;
}
