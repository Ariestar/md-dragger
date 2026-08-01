import type { Doc, MarkerType } from '../markdown/document-types';
import type { LineRange } from '../markdown/line-range-types';
import type { TextChange } from '../transaction/block-transaction';
import { isCodeFenceLine, isMathFenceLine } from './block-guards';
import type { Block } from './block-types';
import { BlockType } from './block-types';

/** Target shape for block-type conversion (handle menu, commands). */
export type ConvertTo =
    | { type: BlockType.Paragraph }
    | { type: BlockType.Heading; level: 1 | 2 | 3 | 4 | 5 | 6 }
    | { type: BlockType.ListItem; markerType: MarkerType }
    | { type: BlockType.Blockquote }
    | { type: BlockType.CodeBlock }
    | { type: BlockType.MathBlock };

/**
 * Plan character edits that change a block's markdown type.
 * Prefer `block` when you have one; `lines` for raw 1-based spans.
 */
export function planConvert(params: { doc: Doc; block: Block; to: ConvertTo }): TextChange[];
export function planConvert(params: { doc: Doc; lines: LineRange; to: ConvertTo }): TextChange[];
export function planConvert(params: { doc: Doc; block?: Block; lines?: LineRange; to: ConvertTo }): TextChange[] {
    const span = params.block?.lines ?? params.lines;
    if (!span) return [];
    return planConvertLines(params.doc, span.startLine, span.endLine, params.to);
}

type FenceTarget = Extract<ConvertTo, { type: BlockType.CodeBlock | BlockType.MathBlock }>;
type NonFenceTarget = Exclude<ConvertTo, FenceTarget>;

function planConvertLines(doc: Doc, startLine: number, endLine: number, to: ConvertTo): TextChange[] {
    const fenced = readFencedContent(doc, startLine, endLine);

    if (isFenceTarget(to)) {
        if (fenced?.type === to.type) return [];
        return wrapAsFence(doc, startLine, endLine, to, fenced?.contentLines ?? null);
    }

    if (fenced) {
        return unwrapFence(doc, startLine, endLine, fenced.contentLines, to);
    }

    const changes: TextChange[] = [];
    for (let n = startLine; n <= endLine; n++) {
        const line = doc.line(n);
        const next = convertLine(line.text, to, n - startLine + 1);
        if (next !== line.text) {
            changes.push({ from: line.from, to: line.to, insert: next });
        }
    }
    return changes;
}

function isFenceTarget(to: ConvertTo): to is FenceTarget {
    return to.type === BlockType.CodeBlock || to.type === BlockType.MathBlock;
}

function readFencedContent(
    doc: Doc,
    startLine: number,
    endLine: number,
): { type: BlockType.CodeBlock | BlockType.MathBlock; contentLines: string[] } | null {
    const startText = doc.line(startLine).text;
    const endText = doc.line(endLine).text;

    if (isCodeFenceLine(startText) && startLine < endLine && isCodeFenceLine(endText)) {
        return { type: BlockType.CodeBlock, contentLines: innerLines(doc, startLine, endLine) };
    }

    if (isMathFenceLine(startText)) {
        if (startLine === endLine) {
            const content = singleLineMathBody(startText);
            if (content !== null) {
                return { type: BlockType.MathBlock, contentLines: [content] };
            }
        }
        if (startLine < endLine && isMathFenceLine(endText)) {
            return { type: BlockType.MathBlock, contentLines: innerLines(doc, startLine, endLine) };
        }
    }
    return null;
}

function innerLines(doc: Doc, startLine: number, endLine: number): string[] {
    const out: string[] = [];
    for (let n = startLine + 1; n < endLine; n++) out.push(doc.line(n).text);
    return out;
}

function singleLineMathBody(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('$$') || !trimmed.endsWith('$$') || trimmed.length < 4) return null;
    return trimmed.slice(2, -2).trim();
}

function unwrapFence(
    doc: Doc,
    startLine: number,
    endLine: number,
    contentLines: string[],
    to: NonFenceTarget,
): TextChange[] {
    const from = doc.line(startLine).from;
    const toPos = doc.line(endLine).to;
    const insert = contentLines
        .map((line, i) => {
            const { indentRaw, body } = splitIndent(line);
            return formatBody(indentRaw, body, to, i + 1);
        })
        .join('\n');
    return [{ from, to: toPos, insert }];
}

function wrapAsFence(
    doc: Doc,
    startLine: number,
    endLine: number,
    to: FenceTarget,
    existingContent: string[] | null,
): TextChange[] {
    const from = doc.line(startLine).from;
    const toPos = doc.line(endLine).to;
    const content = existingContent
        ? existingContent.join('\n')
        : Array.from(
              { length: endLine - startLine + 1 },
              (_, i) => stripPrefix(doc.line(startLine + i).text).body,
          ).join('\n');
    const fence = to.type === BlockType.CodeBlock ? '```' : '$$';
    return [{ from, to: toPos, insert: `${fence}\n${content}\n${fence}` }];
}

function convertLine(text: string, to: NonFenceTarget, ordinal: number): string {
    const { indentRaw, body } = stripPrefix(text);
    return formatBody(indentRaw, body, to, ordinal);
}

function formatBody(indentRaw: string, body: string, to: NonFenceTarget, ordinal: number): string {
    switch (to.type) {
        case BlockType.Paragraph:
            return `${indentRaw}${body}`;
        case BlockType.Heading:
            return `${indentRaw}${'#'.repeat(to.level)} ${body}`;
        case BlockType.ListItem:
            return `${indentRaw}${listMarker(to.markerType, ordinal)}${body}`;
        case BlockType.Blockquote:
            return `> ${indentRaw}${body}`;
    }
}

function listMarker(markerType: MarkerType, ordinal: number): string {
    switch (markerType) {
        case 'ordered':
            return `${ordinal}. `;
        case 'task':
            return '- [ ] ';
        case 'unordered':
            return '- ';
    }
}

/** Strip quote / heading / list markers; keep indent. */
function stripPrefix(text: string): { indentRaw: string; body: string } {
    const quoteMatch = text.match(/^(\s*>\s?)*/);
    const withoutQuote = text.slice(quoteMatch?.[0].length ?? 0);
    const { indentRaw, body } = splitIndent(withoutQuote);
    let rest = body.replace(/^#{1,6}\s+/, '');
    const listMatch = rest.match(/^((?:[-*+]\s\[[ xX]\]\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))/);
    if (listMatch) rest = rest.slice(listMatch[0].length);
    return { indentRaw, body: rest };
}

function splitIndent(text: string): { indentRaw: string; body: string } {
    const m = text.match(/^(\s*)/);
    const indentRaw = m?.[0] ?? '';
    return { indentRaw, body: text.slice(indentRaw.length) };
}
