import { describe, expect, it } from 'vitest';
import type { DocLikeWithRange } from '../markdown/document-types';
import {
    planBlockTypeConversionChanges,
    type BlockTypeConversionChange,
} from './block-type-conversion';
import { BlockType } from './block-types';

describe('block type conversion planner', () => {
    it('plans heading conversion from plain text', () => {
        expect(applyPlannedConversion('alpha\nbeta', 1, 1, { type: BlockType.Heading, level: 2 })).toBe('## alpha\nbeta');
    });

    it('plans ordered list markers by selected line order', () => {
        expect(applyPlannedConversion('- alpha\n- beta', 1, 2, {
            type: BlockType.ListItem,
            markerType: 'ordered',
        })).toBe('1. alpha\n2. beta');
    });

    it('clears quote markers before converting to another block type', () => {
        expect(applyPlannedConversion('> alpha\n> beta', 1, 2, {
            type: BlockType.ListItem,
            markerType: 'unordered',
        })).toBe('- alpha\n- beta');
    });

    it('clears quote markers before wrapping a code block', () => {
        expect(applyPlannedConversion('> alpha\nbeta', 1, 1, { type: BlockType.CodeBlock })).toBe('```\nalpha\n```\nbeta');
    });

    it('clears quote markers before wrapping a math block', () => {
        expect(applyPlannedConversion('> x = y\nbeta', 1, 1, { type: BlockType.MathBlock })).toBe('$$\nx = y\n$$\nbeta');
    });

    it('clears code fences before converting a code block to a paragraph', () => {
        expect(applyPlannedConversion('```\nalpha\n```', 1, 3, { type: BlockType.Paragraph })).toBe('alpha');
    });

    it('clears code fences before converting a code block to a heading', () => {
        expect(applyPlannedConversion('```\nalpha\n```', 1, 3, {
            type: BlockType.Heading,
            level: 3,
        })).toBe('### alpha');
    });

    it('clears code fences before converting a code block to a list item', () => {
        expect(applyPlannedConversion('```\nalpha\nbeta\n```', 1, 4, {
            type: BlockType.ListItem,
            markerType: 'ordered',
        })).toBe('1. alpha\n2. beta');
    });

    it('keeps code content as literal text while clearing code fences', () => {
        expect(applyPlannedConversion('```\n# alpha\n- beta\n```', 1, 4, {
            type: BlockType.Paragraph,
        })).toBe('# alpha\n- beta');
    });

    it('clears math fences before converting a math block to a paragraph', () => {
        expect(applyPlannedConversion('$$\nx = y\n$$', 1, 3, { type: BlockType.Paragraph })).toBe('x = y');
    });

    it('clears single-line math fences before converting to a heading', () => {
        expect(applyPlannedConversion('$$x = y$$', 1, 1, {
            type: BlockType.Heading,
            level: 2,
        })).toBe('## x = y');
    });

    it('rewraps code fences when converting a code block to a math block', () => {
        expect(applyPlannedConversion('```\nx = y\n```', 1, 3, { type: BlockType.MathBlock })).toBe('$$\nx = y\n$$');
    });

    it('rewraps math fences when converting a math block to a code block', () => {
        expect(applyPlannedConversion('$$\nx = y\n$$', 1, 3, { type: BlockType.CodeBlock })).toBe('```\nx = y\n```');
    });
});

function applyPlannedConversion(
    source: string,
    startLineNumber: number,
    endLineNumber: number,
    conversion: Parameters<typeof planBlockTypeConversionChanges>[3]
): string {
    const changes = planBlockTypeConversionChanges(createDoc(source), startLineNumber, endLineNumber, conversion);
    return applyChanges(source, changes);
}

function createDoc(source: string): DocLikeWithRange {
    const lineTexts = source.split('\n');
    const starts: number[] = [];
    let offset = 0;
    for (const lineText of lineTexts) {
        starts.push(offset);
        offset += lineText.length + 1;
    }

    return {
        lines: lineTexts.length,
        length: source.length,
        line(number: number) {
            const text = lineTexts[number - 1];
            const from = starts[number - 1];
            return { text, from, to: from + text.length };
        },
        sliceString(from: number, to: number) {
            return source.slice(from, to);
        },
    };
}

function applyChanges(source: string, changes: BlockTypeConversionChange[]): string {
    return [...changes]
        .sort((a, b) => b.from - a.from)
        .reduce((text, change) => `${text.slice(0, change.from)}${change.insert}${text.slice(change.to)}`, source);
}
