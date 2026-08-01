import type { Block } from '../block/block-types';
import { BlockType } from '../block/block-types';
import type { DropPosition } from '../command/drop-position';
import type { Doc } from '../markdown/document-types';
import { dropIndentWidth } from '../markdown/drop-locate';
import { formatIndent, parseLine } from '../parse/parse-line';
import { relevelListText } from './list-mutation';

/**
 * Text to insert for a move: relevel list indent from DropPosition.parent only,
 * then ensure a trailing newline.
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
    const { sourceBlock, sourceContent, position, tabSize, indentUnit } = params;

    const parse = (line: string) => parseLine(line, tabSize);
    let text = sourceContent;

    // Structure only: parent list → target indent from dropIndentWidth(parent).
    // No getListContextNearLine / listSampleLine side channel.
    const nestList = sourceBlock.type === BlockType.ListItem || position.parent?.type === BlockType.ListItem;
    if (sourceBlock.type !== BlockType.Blockquote && nestList) {
        const targetIndentWidth = dropIndentWidth(position, { tabSize, indentUnit });
        text = relevelListText({
            sourceContent: text,
            parse,
            formatIndentFn: (sample, width) => formatIndent(width, tabSize, sample),
            targetIndentWidth,
        });
    }

    return text.endsWith('\n') ? text : `${text}\n`;
}
