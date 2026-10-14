import type { Doc, MarkerType } from '../markdown/document-types';
import type { LineRange } from '../markdown/line-range-types';
import type { TextChange } from '../transaction/block-transaction';
import { isCodeFenceLine, singleLineFenceBody } from './block-guards';
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
    | { type: BlockType.Comment }
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
        case BlockType.Comment:
            return { template: '%%\n${content}\n%%' };
    }
}

type ExtractedLine = { indentRaw: string; body: string };

type ExtractedContent = {
    lines: ExtractedLine[];
    callout?: { quotePrefix: string; calloutType: string; fold: string; rawHeader: string };
};

function unwrapBlock(doc: Doc, startLine: number, endLine: number): ExtractedContent {
    const fenced = readFencedContent(doc, startLine, endLine);
    if (fenced) {
        return { lines: fenced.contentLines.map(splitIndent) };
    }

    const startText = doc.line(startLine).text;
    const calloutMatch = startText.match(/^(\s*>\s*)\[!([a-zA-Z0-9_-]+)\]([-+]?)\s*(.*)$/);
    if (calloutMatch) {
        const quotePrefix = calloutMatch[1];
        const calloutType = calloutMatch[2];
        const fold = calloutMatch[3];
        const title = calloutMatch[4].trim();
        const lines: ExtractedLine[] = [];
        if (title.length > 0) {
            lines.push(splitIndent(title));
        }
        for (let i = startLine + 1; i <= endLine; i++) {
            const lineText = doc.line(i).text;
            const stripped = lineText.replace(/^(\s*>\s?)/, '');
            lines.push(splitIndent(stripped));
        }
        return {
            lines,
            callout: { quotePrefix, calloutType, fold, rawHeader: startText },
        };
    }

    const lines = Array.from({ length: endLine - startLine + 1 }, (_, i) => stripPrefix(doc.line(startLine + i).text));
    return { lines };
}

function planConvertLines(doc: Doc, startLine: number, endLine: number, to: ConvertTo): TextChange[] {
    const extracted = unwrapBlock(doc, startLine, endLine);

    const targetCallout = 'template' in to ? to.template.match(/^(\s*>\s*)\[!([a-zA-Z0-9_-]+)/) : null;
    if (extracted.callout && targetCallout) {
        const newType = targetCallout[2];
        if (extracted.callout.calloutType.toLowerCase() === newType.toLowerCase()) return [];
        const startText = extracted.callout.rawHeader;
        const fold = extracted.callout.fold;
        const updated = startText.replace(/^(\s*>\s*)\[![^\]]+\][-+]?/, `$1[!${newType}]${fold}`);
        return [{ from: doc.line(startLine).from, to: doc.line(startLine).to, insert: updated }];
    }

    const fenced = readFencedContent(doc, startLine, endLine);
    if (!('template' in to)) {
        if (to.type === BlockType.CodeBlock && fenced?.type === BlockType.CodeBlock) return [];
        if (to.type === BlockType.MathBlock && fenced?.type === BlockType.MathBlock) return [];
        if (to.type === BlockType.Comment && fenced?.type === BlockType.Comment) return [];
    }

    const target = resolveBlockTemplate(to);
    const from = doc.line(startLine).from;
    const toPos = doc.line(endLine).to;
    const formatted = formatBlockContent(extracted.lines, target);

    if (formatted === doc.sliceString(from, toPos)) return [];
    return [{ from, to: toPos, insert: formatted }];
}

function formatBlockContent(contentLines: ExtractedLine[], target: BlockTemplate): string {
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

const DELIMITED_TYPES = [
    { type: BlockType.MathBlock, marker: '$$' },
    { type: BlockType.Comment, marker: '%%' },
] as const;

function readFencedContent(
    doc: Doc,
    startLine: number,
    endLine: number,
): { type: BlockType.CodeBlock | BlockType.MathBlock | BlockType.Comment; contentLines: string[] } | null {
    const startText = doc.line(startLine).text;
    const endText = doc.line(endLine).text;

    if (isCodeFenceLine(startText) && startLine < endLine && isCodeFenceLine(endText)) {
        return { type: BlockType.CodeBlock, contentLines: innerLines(doc, startLine, endLine) };
    }

    for (const { type, marker } of DELIMITED_TYPES) {
        if (!startText.trimStart().startsWith(marker)) continue;
        if (startLine === endLine) {
            const content = singleLineFenceBody(startText, marker);
            return content !== null ? { type, contentLines: [content] } : null;
        }
        if (startLine < endLine && endText.trimStart().startsWith(marker)) {
            return { type, contentLines: innerLines(doc, startLine, endLine) };
        }
    }
    return null;
}

function innerLines(doc: Doc, startLine: number, endLine: number): string[] {
    const out: string[] = [];
    for (let n = startLine + 1; n < endLine; n++) out.push(doc.line(n).text);
    return out;
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
