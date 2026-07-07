import type { DocLikeWithRange, MarkerType } from '../markdown/document-types';
import { isCodeFenceLine, isMathFenceLine } from './block-guards';
import { BlockType } from './block-types';

export type BlockTypeConversion =
    | { type: BlockType.Paragraph }
    | { type: BlockType.Heading; level: 1 | 2 | 3 | 4 | 5 | 6 }
    | { type: BlockType.ListItem; markerType: MarkerType }
    | { type: BlockType.Blockquote }
    | { type: BlockType.CodeBlock }
    | { type: BlockType.MathBlock };

export type BlockTypeConversionChange = {
    from: number;
    to: number;
    insert: string;
};

export function planBlockTypeConversionChanges(
    doc: DocLikeWithRange,
    startLineNumber: number,
    endLineNumber: number,
    conversion: BlockTypeConversion
): BlockTypeConversionChange[] {
    const fencedBlock = readFencedBlockContentLines(doc, startLineNumber, endLineNumber);

    if (isFencedBlockConversion(conversion)) {
        if (fencedBlock?.type === conversion.type) return [];
        return planFencedBlockChanges(doc, startLineNumber, endLineNumber, conversion, fencedBlock?.contentLines ?? null);
    }

    if (fencedBlock) {
        return planFencedBlockUnwrapChanges(doc, startLineNumber, endLineNumber, fencedBlock.contentLines, conversion);
    }

    const changes: BlockTypeConversionChange[] = [];
    for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
        const line = doc.line(lineNumber);
        const next = convertLine(line.text, conversion, lineNumber - startLineNumber + 1);
        if (next === line.text) continue;
        changes.push({ from: line.from, to: line.to, insert: next });
    }
    return changes;
}

type FencedBlockConversion = Extract<BlockTypeConversion, { type: BlockType.CodeBlock | BlockType.MathBlock }>;

type FencedBlockContent = {
    type: BlockType.CodeBlock | BlockType.MathBlock;
    contentLines: string[];
};

function isFencedBlockConversion(conversion: BlockTypeConversion): conversion is FencedBlockConversion {
    return conversion.type === BlockType.CodeBlock || conversion.type === BlockType.MathBlock;
}

function readFencedBlockContentLines(
    doc: DocLikeWithRange,
    startLineNumber: number,
    endLineNumber: number
): FencedBlockContent | null {
    const startText = doc.line(startLineNumber).text;
    const endText = doc.line(endLineNumber).text;
    if (isCodeFenceLine(startText) && startLineNumber < endLineNumber && isCodeFenceLine(endText)) {
        return {
            type: BlockType.CodeBlock,
            contentLines: readInnerLines(doc, startLineNumber, endLineNumber),
        };
    }
    if (isMathFenceLine(startText)) {
        if (startLineNumber === endLineNumber) {
            const content = readSingleLineMathContent(startText);
            if (content !== null) {
                return { type: BlockType.MathBlock, contentLines: [content] };
            }
        }
        if (startLineNumber < endLineNumber && isMathFenceLine(endText)) {
            return {
                type: BlockType.MathBlock,
                contentLines: readInnerLines(doc, startLineNumber, endLineNumber),
            };
        }
    }
    return null;
}

function readInnerLines(doc: DocLikeWithRange, startLineNumber: number, endLineNumber: number): string[] {
    return Array.from({ length: endLineNumber - startLineNumber - 1 }, (_, index) => (
        doc.line(startLineNumber + index + 1).text
    ));
}

function readSingleLineMathContent(text: string): string | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('$$') || !trimmed.endsWith('$$') || trimmed.length < 4) return null;
    return trimmed.slice(2, -2).trim();
}

function planFencedBlockUnwrapChanges(
    doc: DocLikeWithRange,
    startLineNumber: number,
    endLineNumber: number,
    contentLines: string[],
    conversion: Exclude<BlockTypeConversion, FencedBlockConversion>
): BlockTypeConversionChange[] {
    const startLine = doc.line(startLineNumber);
    const endLine = doc.line(endLineNumber);
    const insert = contentLines
        .map((line, index) => convertFencedContentLine(line, conversion, index + 1))
        .join('\n');
    return [{ from: startLine.from, to: endLine.to, insert }];
}

function planFencedBlockChanges(
    doc: DocLikeWithRange,
    startLineNumber: number,
    endLineNumber: number,
    conversion: FencedBlockConversion,
    existingContentLines: string[] | null
): BlockTypeConversionChange[] {
    const startLine = doc.line(startLineNumber);
    const endLine = doc.line(endLineNumber);
    const content = existingContentLines
        ? existingContentLines.join('\n')
        : Array.from({ length: endLineNumber - startLineNumber + 1 }, (_, index) => {
            const line = doc.line(startLineNumber + index);
            return stripKnownBlockPrefix(line.text).body;
        }).join('\n');
    const fence = conversion.type === BlockType.CodeBlock ? '```' : '$$';
    return [{ from: startLine.from, to: endLine.to, insert: `${fence}\n${content}\n${fence}` }];
}

function convertLine(text: string, conversion: Exclude<BlockTypeConversion, FencedBlockConversion>, ordinal: number): string {
    const { indentRaw, body } = stripKnownBlockPrefix(text);
    return formatConvertedLine(indentRaw, body, conversion, ordinal);
}

function convertFencedContentLine(text: string, conversion: Exclude<BlockTypeConversion, FencedBlockConversion>, ordinal: number): string {
    const { indentRaw, body } = splitIndent(text);
    return formatConvertedLine(indentRaw, body, conversion, ordinal);
}

function formatConvertedLine(
    indentRaw: string,
    body: string,
    conversion: Exclude<BlockTypeConversion, FencedBlockConversion>,
    ordinal: number
): string {
    switch (conversion.type) {
        case BlockType.Paragraph:
            return `${indentRaw}${body}`;
        case BlockType.Heading:
            return `${indentRaw}${'#'.repeat(conversion.level)} ${body}`;
        case BlockType.ListItem:
            return `${indentRaw}${formatListMarker(conversion.markerType, ordinal)}${body}`;
        case BlockType.Blockquote:
            return `> ${indentRaw}${body}`;
    }
}

function formatListMarker(markerType: MarkerType, ordinal: number): string {
    switch (markerType) {
        case 'ordered':
            return `${ordinal}. `;
        case 'task':
            return '- [ ] ';
        case 'unordered':
            return '- ';
    }
}

function stripKnownBlockPrefix(text: string): { indentRaw: string; body: string } {
    const quoteMatch = text.match(/^(\s*>\s?)*/);
    const quotePrefix = quoteMatch?.[0] ?? '';
    const withoutQuote = text.slice(quotePrefix.length);
    const { indentRaw, body } = splitIndent(withoutQuote);
    let rest = body;

    rest = rest.replace(/^#{1,6}\s+/, '');
    const listMatch = rest.match(/^((?:[-*+]\s\[[ xX]\]\s+)|(?:[-*+]\s+)|(?:\d+[.)]\s+))/);
    if (listMatch) {
        rest = rest.slice(listMatch[0].length);
    }
    return { indentRaw, body: rest };
}

function splitIndent(text: string): { indentRaw: string; body: string } {
    const indentMatch = text.match(/^(\s*)/);
    const indentRaw = indentMatch?.[0] ?? '';
    return { indentRaw, body: text.slice(indentRaw.length) };
}
