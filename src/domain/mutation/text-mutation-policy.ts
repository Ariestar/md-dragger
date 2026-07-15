import type { Block } from '../block/block-types';
import { BlockType } from '../block/block-types';
import { relevelListText, getListContextNearLine } from './list-mutation';
import type { DropPosition } from '../command/drop-position';
import { listSampleLine, dropIndentWidth } from '../markdown/drop-locate';
import type { Doc } from '../markdown/document-types';
import { parseLine, formatIndent } from '../parse/parse-line';

/**
 * Text to insert for a move: optional list relevel, then trailing newline.
 */
export function insertTextForMove(params: {
    doc: Doc;
    sourceBlock: Block;
    targetLineNumber: number;
    sourceContent: string;
    position: DropPosition;
    tabSize: number;
    indentUnit: number;
}): string {
    const {
        doc,
        sourceBlock,
        targetLineNumber,
        sourceContent,
        position,
        tabSize,
        indentUnit,
    } = params;

    const parse = (line: string) => parseLine(line, tabSize);
    let text = sourceContent;

    // Quotes keep source shape; lists relevel to drop indent.
    if (sourceBlock.type !== BlockType.Blockquote) {
        const relevel = sourceBlock.type === BlockType.ListItem
            || position.parent?.type === BlockType.ListItem;
        text = relevelListText({
            doc,
            sourceContent: text,
            targetLineNumber,
            parse,
            formatIndentFn: (sample, width) => formatIndent(width, tabSize, sample),
            getListContext: (activeDoc, lineNumber) =>
                getListContextNearLine(activeDoc, lineNumber, parse),
            targetIndentWidth: relevel
                ? dropIndentWidth(position, { tabSize, indentUnit })
                : undefined,
            contextLineNumber: listSampleLine(position),
        });
    }

    return text.endsWith('\n') ? text : `${text}\n`;
}
