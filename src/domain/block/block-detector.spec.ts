import { describe, expect, it } from 'vitest';
import { stringDoc } from '../transaction/string-doc';
import { detectBlock } from './block-detector';
import { BlockType } from './block-types';

describe('domain/block-detector', () => {
    it('is order-independent: querying parent first or child first yields identical results', () => {
        const text = ['- parent list item', '    indented continuation text'].join('\n');

        // Order 1: parent then child
        const doc1 = stringDoc(text);
        const p1 = detectBlock(doc1, 1, { tabSize: 4 });
        const c1 = detectBlock(doc1, 2, { tabSize: 4 });

        // Order 2: child then parent
        const doc2 = stringDoc(text);
        const c2 = detectBlock(doc2, 2, { tabSize: 4 });
        const p2 = detectBlock(doc2, 1, { tabSize: 4 });

        expect(p1).toEqual(p2);
        expect(c1).toEqual(c2);

        expect(p1?.type).toBe(BlockType.ListItem);
        expect(p1?.lines.startLine).toBe(1);
        expect(p1?.lines.endLine).toBe(2);

        expect(c1?.type).toBe(BlockType.Paragraph);
        expect(c1?.lines.startLine).toBe(2);
        expect(c1?.lines.endLine).toBe(2);
    });

    it('detects nested list items with independent block starts', () => {
        const doc = stringDoc(['- parent item', '    - nested item'].join('\n'));

        const parent = detectBlock(doc, 1, { tabSize: 4 });
        expect(parent?.type).toBe(BlockType.ListItem);
        expect(parent?.lines.startLine).toBe(1);

        const nested = detectBlock(doc, 2, { tabSize: 4 });
        expect(nested?.type).toBe(BlockType.ListItem);
        expect(nested?.lines.startLine).toBe(2);
    });

    it('keeps atomic multi-line code blocks claiming inner lines', () => {
        const doc = stringDoc(['```js', 'const x = 1;', '```'].join('\n'));

        const head = detectBlock(doc, 1, { tabSize: 4 });
        expect(head?.type).toBe(BlockType.CodeBlock);
        expect(head?.lines.startLine).toBe(1);
        expect(head?.lines.endLine).toBe(3);

        const inner = detectBlock(doc, 2, { tabSize: 4 });
        expect(inner?.type).toBe(BlockType.CodeBlock);
        expect(inner?.lines.startLine).toBe(1);
        expect(inner?.lines.endLine).toBe(3);
    });

    it('keeps table inner lines claiming table start line', () => {
        const doc = stringDoc(['| a | b |', '|---|---|', '| 1 | 2 |'].join('\n'));

        const row2 = detectBlock(doc, 2, { tabSize: 4 });
        expect(row2?.type).toBe(BlockType.Table);
        expect(row2?.lines.startLine).toBe(1);
        expect(row2?.lines.endLine).toBe(3);
    });
});
