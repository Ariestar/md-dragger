import { BlockInfo } from '../block/block-types';
import { adjustListToTargetContext, buildInsertText, getListContextNearLine } from './list-mutation';
import type { ListDropTarget } from '../command/drop-target';
import { Doc } from '../markdown/document-types';
import { LineParsingContext } from '../markdown/line-parsing-service';

export function buildInsertTextForDrop(params: {
    lineParsing: LineParsingContext;
    doc: Doc;
    sourceBlock: BlockInfo;
    targetLineNumber: number;
    sourceContent: string;
    listIntent?: ListDropTarget;
}): string {
    const {
        lineParsing,
        doc,
        sourceBlock,
        targetLineNumber,
        sourceContent,
        listIntent,
    } = params;
    const getListContextForDoc = (activeDoc: Doc, lineNumber: number) =>
        getListContextNearLine(activeDoc, lineNumber, lineParsing.parseLine);

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
            listIntent,
        }),
    });
}
