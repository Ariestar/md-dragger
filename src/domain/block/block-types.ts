/**
 * Block kinds detected from Markdown source.
 */
export enum BlockType {
    Paragraph = 'paragraph',
    Heading = 'heading',
    ListItem = 'list-item',
    CodeBlock = 'code-block',
    Blockquote = 'blockquote',
    Table = 'table',
    MathBlock = 'math-block',
    Callout = 'callout',
    HorizontalRule = 'hr',
    Unknown = 'unknown',
}

import type { LineRange } from '../markdown/line-range-types';

/**
 * One structural block over the document.
 * Geometry is 1-based inclusive lines only — no char/content/indent cache.
 */
export type Block = {
    type: BlockType;
    lines: LineRange;
};

export function isContainerType(type: BlockType): boolean {
    return type === BlockType.ListItem || type === BlockType.Blockquote || type === BlockType.Callout;
}
