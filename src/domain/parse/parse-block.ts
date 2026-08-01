import { isCodeFenceLine, isMathFenceLine } from '../block/block-guards';
import { BlockType } from '../block/block-types';
import type { Doc } from '../markdown/document-types';
import type { LineRange } from '../markdown/line-range-types';
import { parseLine } from './parse-line';
import type { ParsedBlock } from './types';

/**
 * Parse block structure from text in [lines].
 * Does not take or return Block — caller holds identity/range.
 */
export function parseBlock(doc: Doc, lines: LineRange, tabSize: number): ParsedBlock {
    const start = Math.max(1, lines.startLine);
    const end = Math.min(doc.lines, lines.endLine);
    if (start > end || start > doc.lines) {
        return { type: BlockType.Unknown };
    }

    const headText = doc.line(start).text;
    const head = parseLine(headText, tabSize);

    // fence blocks
    if (head.marker?.kind === 'fence') {
        const contentLines: string[] = [];
        for (let n = start + 1; n < end; n++) {
            contentLines.push(doc.line(n).text);
        }
        // single-line $$x$$
        if (head.marker.fence === 'math' && start === end) {
            const t = headText.trim();
            if (t.startsWith('$$') && t.endsWith('$$') && t.length > 4) {
                return {
                    type: BlockType.MathBlock,
                    contentLines: [t.slice(2, -2).trim()],
                };
            }
        }
        if (head.marker.fence === 'code') {
            return {
                type: BlockType.CodeBlock,
                lang: head.marker.info ?? null,
                contentLines,
            };
        }
        return {
            type: BlockType.MathBlock,
            contentLines,
        };
    }

    // also detect fence by raw if marker missed
    if (isCodeFenceLine(headText.trimStart()) && end > start) {
        const contentLines: string[] = [];
        for (let n = start + 1; n < end; n++) contentLines.push(doc.line(n).text);
        const info =
            headText
                .trimStart()
                .replace(/^```\s*/, '')
                .trim() || null;
        return { type: BlockType.CodeBlock, lang: info, contentLines };
    }
    if (isMathFenceLine(headText.trimStart()) && end > start) {
        const contentLines: string[] = [];
        for (let n = start + 1; n < end; n++) contentLines.push(doc.line(n).text);
        return { type: BlockType.MathBlock, contentLines };
    }

    if (head.marker?.kind === 'heading') {
        return { type: BlockType.Heading, level: head.marker.level };
    }
    if (head.marker?.kind === 'list') {
        return {
            type: BlockType.ListItem,
            markerType: head.marker.markerType,
            checked: head.marker.checked,
            indent: head.indent,
        };
    }
    if (head.marker?.kind === 'hr') {
        return { type: BlockType.HorizontalRule };
    }
    if (head.marker?.kind === 'table-row') {
        return { type: BlockType.Table };
    }
    if (head.marker?.kind === 'callout') {
        return { type: BlockType.Callout, calloutType: head.marker.calloutType };
    }
    if (head.quote.depth > 0) {
        return { type: BlockType.Blockquote, quoteDepth: head.quote.depth };
    }
    if (head.body.trim() === '' && !head.marker) {
        return { type: BlockType.Unknown };
    }
    return { type: BlockType.Paragraph };
}
