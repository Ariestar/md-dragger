import type { Block } from '../block/block-types';
import { BlockType } from '../block/block-types';
import { adjustListToTargetContext, buildInsertText, getListContextNearLine } from './list-mutation';
import type { DropPosition } from '../command/drop-position';
import { dropIndentWidth } from '../markdown/drop-locate';
import { Doc } from '../markdown/document-types';
import { LineParsingContext } from '../markdown/line-parsing-service';

export function buildInsertTextForDrop(params: {
    lineParsing: LineParsingContext;
    doc: Doc;
    sourceBlock: Block;
    targetLineNumber: number;
    sourceContent: string;
    position: DropPosition;
    indentUnit?: number;
}): string {
    const {
        lineParsing,
        doc,
        sourceBlock,
        targetLineNumber,
        sourceContent,
        position,
        indentUnit = 2,
    } = params;
    const getListContextForDoc = (activeDoc: Doc, lineNumber: number) =>
        getListContextNearLine(activeDoc, lineNumber, lineParsing.parseLine);

    const tabSize = lineParsing.getTabSize();
    const targetIndentWidth = dropIndentWidth(position, { tabSize, indentUnit });
    const contextLineNumber = position.kind === 'inside'
        ? position.parent.lines.startLine
        : targetLineNumber;

    return buildInsertText({
        sourceBlockType: sourceBlock.type,
        sourceContent,
        adjustListToTargetContext: (content) => adjustListToTargetContext({
            doc,
            sourceContent: content,
            targetLineNumber,
            parseLineWithQuote: lineParsing.parseLine,
            buildIndentStringFromSample: lineParsing.buildIndentStringFromSample,
            getListContext: getListContextForDoc,
            targetIndentWidth: sourceBlock.type === BlockType.ListItem || position.kind === 'inside'
                ? targetIndentWidth
                : undefined,
            contextLineNumber,
        }),
    });
}
