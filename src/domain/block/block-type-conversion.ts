import type { Doc, MarkerType } from '../markdown/document-types';
import type { LineRange } from '../markdown/line-range-types';
import type { TextChange } from '../transaction/block-transaction';
import { isCodeFenceLine, isMathFenceLine } from './block-guards';
import type { Block } from './block-types';
import { BlockType } from './block-types';

/** Unified template definition for any block style. */
export type BlockTemplate = {
    /** Outer template containing ${content}. E.g. "# ${content}", "```${lang}\n${content}\n```" */
    template: string;
    /** Prefix applied to each line of content (e.g. "> " for quotes/callouts, "${ordinal}. " for numbered lists) */
    linePrefix?: string;
    /** Key-value variables for ${key} interpolation in template */
    variables?: Record<string, string>;
};

/** Target shape for block-type conversion (handle menu, commands). */
export type ConvertTo =
    | { type: BlockType.Paragraph }
    | { type: BlockType.Heading; level: 1 | 2 | 3 | 4 | 5 | 6 }
    | { type: BlockType.ListItem; markerType: MarkerType }
    | { type: BlockType.Blockquote }
    | { type: BlockType.CodeBlock }
    | { type: BlockType.MathBlock }
    | BlockTemplate;

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

export function resolveBlockTemplate(to: ConvertTo): BlockTemplate {
    if ('template' in to) return to;
    switch (to.type) {
        case BlockType.Paragraph:
            return { template: '${content}' };
        case BlockType.Heading:
            return { template: `${'#'.repeat(to.level)} \${content}` };
        case BlockType.ListItem:
            return {
                template: '${content}',
                linePrefix: to.markerType === 'ordered' ? '${ordinal}. ' : to.markerType === 'task' ? '- [ ] ' : '- ',
            };
        case BlockType.Blockquote:
            return { template: '${content}', linePrefix: '> ' };
        case BlockType.CodeBlock:
            return { template: '```\n${content}\n```' };
        case BlockType.MathBlock:
            return { template: '$$\n${content}\n$$' };
    }
}

function planConvertLines(doc: Doc, startLine: number, endLine: number, to: ConvertTo): TextChange[] {
    const fenced = readFencedContent(doc, startLine, endLine);
    if (!('template' in to)) {
        if (to.type === BlockType.CodeBlock && fenced?.type === BlockType.CodeBlock) return [];
        if (to.type === BlockType.MathBlock && fenced?.type === BlockType.MathBlock) return [];
    }

    const contentLines: Array<{ indentRaw: string; body: string }> = fenced
        ? fenced.contentLines.map(splitIndent)
        : Array.from({ length: endLine - startLine + 1 }, (_, i) => stripPrefix(doc.line(startLine + i).text));

    const target = resolveBlockTemplate(to);
    const from = doc.line(startLine).from;
    const toPos = doc.line(endLine).to;
    const formatted = formatBlockContent(contentLines, target);

    if (formatted === doc.sliceString(from, toPos)) return [];
    return [{ from, to: toPos, insert: formatted }];
}

function formatBlockContent(contentLines: Array<{ indentRaw: string; body: string }>, target: BlockTemplate): string {
    const formattedLines = contentLines.map((line, index) => {
        if (!target.linePrefix) return `${line.indentRaw}${line.body}`;
        const prefix = target.linePrefix.replace('${ordinal}', String(index + 1));
        return `${line.indentRaw}${prefix}${line.body}`;
    });

    const content = formattedLines.join('\n');
    const vars = target.variables ?? {};
    return target.template.replace(/\$\{([a-zA-Z0-9_-]+)\}/g, (_, key) =>
        key === 'content' ? content : (vars[key] ?? ''),
    );
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

/** Strip quote, callout, heading, list markers; keep indent. */
function stripPrefix(text: string): { indentRaw: string; body: string } {
    const quoteMatch = text.match(/^(\s*>\s?)*/);
    const withoutQuote = text.slice(quoteMatch?.[0].length ?? 0);
    const { indentRaw, body } = splitIndent(withoutQuote);
    let rest = body.replace(/^#{1,6}\s+/, '');
    const calloutMatch = rest.match(/^\[![^\]]+\]\s*/);
    if (calloutMatch) rest = rest.slice(calloutMatch[0].length);
    const listMatch = rest.match(/^((?:[-*+]\s\[[ xX]\]\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))/);
    if (listMatch) rest = rest.slice(listMatch[0].length);
    return { indentRaw, body: rest };
}

function splitIndent(text: string): { indentRaw: string; body: string } {
    const m = text.match(/^(\s*)/);
    const indentRaw = m?.[0] ?? '';
    return { indentRaw, body: text.slice(indentRaw.length) };
}
