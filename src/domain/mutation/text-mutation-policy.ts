import { BlockInfo } from '../block/block-types';
import {
    adjustListToTargetContext,
    buildInsertText,
    getListContext,
} from './list-mutation';
import type { ListDropTarget } from '../command/drop-target';
import { DocLike } from '../markdown/document-types';
import { LineParsingContext } from '../markdown/line-parsing-service';

export function buildInsertTextForDrop(params: {
    lineParsing: LineParsingContext;
    doc: DocLike;
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
    const getListContextForDoc = (activeDoc: DocLike, lineNumber: number) =>
        getListContext(activeDoc, lineNumber, lineParsing.parseLine);

    return buildInsertText({
        sourceBlockType: sourceBlock.type,
        sourceContent,
        adjustListToTargetContext: (content) => adjustListToTargetContext({
            doc,
            sourceContent: content,
            targetLineNumber,
            parseLineWithQuote: lineParsing.parseLine,
            getIndentUnitWidth: lineParsing.getIndentUnitWidth,
            buildIndentStringFromSample: lineParsing.buildIndentStringFromSample,
            getListContext: getListContextForDoc,
            listIntent,
        }),
    });
}
