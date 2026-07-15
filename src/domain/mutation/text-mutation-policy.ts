import type { Block } from '../block/block-types';
import { BlockType } from '../block/block-types';
import {
    relevelListText,
    buildInsertText,
    getListContextNearLine,
} from './list-mutation';
import type { DropPosition } from '../command/drop-position';
import { listSampleLine, dropIndentWidth } from '../markdown/drop-locate';
import type { Doc } from '../markdown/document-types';
import { parseLine, formatIndent } from '../parse/parse-line';

/**
 * Build the text to insert at a drop site: relevel list indent when needed,
 * then ensure a trailing newline for move insertion.
 */
export function insertTextForMove(params: {
    doc: Doc;
    sourceBlock: Block;
    targetLineNumber: number;
    sourceContent: string;
    position: DropPosition;
    tabSize: number;
    indentUnit?: number;
}): string {
    const {
        doc,
        sourceBlock,
        targetLineNumber,
        sourceContent,
        position,
        tabSize,
        indentUnit = 2,
    } = params;

    const parse = (line: string) => parseLine(line, tabSize);
    const targetIndentWidth = dropIndentWidth(position, { tabSize, indentUnit });
    const contextLineNumber = listSampleLine(position);
    const relevelList = sourceBlock.type === BlockType.ListItem
        || position.parent?.type === BlockType.ListItem;

    return buildInsertText({
        sourceBlockType: sourceBlock.type,
        sourceContent,
        relevelListText: (content) => relevelListText({
            doc,
            sourceContent: content,
            targetLineNumber,
            parse: parse,
            formatIndentFn: (sample, width) => formatIndent(width, tabSize, sample),
            getListContext: (activeDoc, lineNumber) =>
                getListContextNearLine(activeDoc, lineNumber, parse),
            targetIndentWidth: relevelList ? targetIndentWidth : undefined,
            contextLineNumber,
        }),
    });
}
