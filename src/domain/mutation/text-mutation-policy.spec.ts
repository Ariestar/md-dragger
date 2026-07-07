import { describe, expect, it } from 'vitest';
import { BlockInfo, BlockType } from '../block/block-types';
import type { DocLike } from '../markdown/document-types';
import { createLineParsingContext } from '../markdown/line-parsing-service';
import { buildInsertTextForDrop } from './text-mutation-policy';

function createDoc(docText: string): DocLike {
    const lines = docText.split('\n');
    return {
        lines: lines.length,
        line: (n: number) => ({
            text: lines[n - 1] ?? '',
        }),
    };
}

function createPolicy(docText: string) {
    const doc = createDoc(docText);
    const lineParsing = createLineParsingContext(4);
    return {
        buildInsertText: (sourceBlock: BlockInfo, targetLineNumber: number, sourceContent: string) =>
            buildInsertTextForDrop({
                lineParsing,
                doc,
                sourceBlock,
                targetLineNumber,
                sourceContent,
            }),
    };
}

function createBlock(type: BlockType, content: string): BlockInfo {
    return {
        type,
        startLine: 0,
        endLine: Math.max(0, content.split('\n').length - 1),
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

describe('buildInsertTextForDrop', () => {
    it('keeps callout quote markers when building insert text', () => {
        const { buildInsertText } = createPolicy('paragraph');
        const sourceBlock = createBlock(BlockType.Callout, '> [!TIP]\n> keep marker');

        const insertText = buildInsertText(sourceBlock, 2, sourceBlock.content);

        expect(insertText).toBe('> [!TIP]\n> keep marker\n');
    });

    it('keeps source list marker type when inserting into task context', () => {
        const { buildInsertText } = createPolicy('- [ ] existing task');
        const sourceBlock = createBlock(BlockType.ListItem, '- moved item');

        const insertText = buildInsertText(sourceBlock, 2, sourceBlock.content);

        expect(insertText).toBe('- moved item\n');
    });

    it('keeps task marker when inserting near unordered list context', () => {
        const { buildInsertText } = createPolicy('- existing bullet');
        const sourceBlock = createBlock(BlockType.ListItem, '- [ ] keep task');

        const insertText = buildInsertText(sourceBlock, 2, sourceBlock.content);

        expect(insertText).toBe('- [ ] keep task\n');
    });
});


