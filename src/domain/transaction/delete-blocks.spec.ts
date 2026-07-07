import { describe, expect, it } from 'vitest';
import { BlockType, type BlockInfo } from '../block/block-types';
import { createDeleteCommand } from '../command/delete-command';
import type { DocLikeWithRange } from '../markdown/document-types';
import { createBlockSelection } from '../selection/block-selection';
import { planBlockCommandTransaction } from './block-command-transaction';
import type { BlockTransaction } from './block-transaction';

function createDoc(text: string): DocLikeWithRange {
    const lines = text.split('\n');
    const starts: number[] = [];
    let offset = 0;
    for (const line of lines) {
        starts.push(offset);
        offset += line.length + 1;
    }
    return {
        length: text.length,
        lines: lines.length,
        line: (n) => {
            const textLine = lines[n - 1] ?? '';
            const from = starts[n - 1] ?? text.length;
            return {
                text: textLine,
                from,
                to: from + textLine.length,
            };
        },
        sliceString: (from, to) => text.slice(from, to),
    };
}

function block(startLine: number, endLine = startLine): BlockInfo {
    return {
        type: BlockType.Paragraph,
        startLine,
        endLine,
        from: 0,
        to: 0,
        indentLevel: 0,
        content: '',
    };
}

function applyChanges(text: string, transaction: BlockTransaction): string {
    return transaction.changes.reduce(
        (current, change) => current.slice(0, change.from) + change.insert + current.slice(change.to),
        text
    );
}

describe('delete block command transaction', () => {
    it('rejects empty or invalid selections', () => {
        const doc = createDoc('a\nb');
        const selection = createBlockSelection(block(0), []);

        const result = planBlockCommandTransaction({
            doc,
            command: createDeleteCommand(selection),
        });

        expect(result).toEqual({ type: 'reject', reason: 'empty_selection' });
    });

    it('deletes disjoint ranges from bottom to top', () => {
        const text = 'a\nb\nc\nd';
        const doc = createDoc(text);
        const selection = createBlockSelection(block(0), [
            { startLine: 0, endLine: 0 },
            { startLine: 2, endLine: 2 },
        ]);

        const result = planBlockCommandTransaction({
            doc,
            command: createDeleteCommand(selection),
        });

        expect('type' in result ? result : result.changes).toEqual([
            { from: 4, to: 6, insert: '' },
            { from: 0, to: 2, insert: '' },
        ]);
        expect('type' in result ? null : applyChanges(text, result)).toBe('b\nd');
    });

    it('deletes the final line without leaving a trailing blank line', () => {
        const text = 'a\nb\nc';
        const doc = createDoc(text);
        const selection = createBlockSelection(block(2), [
            { startLine: 2, endLine: 2 },
        ]);

        const result = planBlockCommandTransaction({
            doc,
            command: createDeleteCommand(selection),
        });

        expect('type' in result ? result : result.changes).toEqual([
            { from: 3, to: 5, insert: '' },
        ]);
        expect('type' in result ? null : applyChanges(text, result)).toBe('a\nb');
    });
});
