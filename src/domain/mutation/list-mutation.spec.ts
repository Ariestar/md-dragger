import { describe, expect, it } from 'vitest';
import type { DocLike } from '../markdown/document-types';
import { buildIndentStringFromSample } from '../markdown/indent-calculator';
import { parseLineWithQuote } from '../markdown/line-parser';
import {
    adjustListToTargetContext,
    computeListIndentPlan,
    getListContextNearLine,
} from './list-mutation';

function createDoc(lines: string[]): DocLike {
    return {
        lines: lines.length,
        line: (n: number) => ({ text: lines[n - 1] ?? '' }),
    };
}

const parse = (line: string) => parseLineWithQuote(line, 4);

describe('list-mutation', () => {
    it('resolves list context across a blank target line', () => {
        const doc = createDoc(['- first', '', '- second']);

        const context = getListContextNearLine(doc, 2, parse);

        expect(context).not.toBeNull();
        expect(context?.indentWidth).toBe(0);
        expect(context?.markerType).toBe('unordered');
    });

    it('builds deterministic tab indentation without rounding up', () => {
        expect(buildIndentStringFromSample('\t', 2, 4)).toBe('  ');
        expect(buildIndentStringFromSample('\t', 6, 4)).toBe('\t  ');
    });

    it('computes shared indent plan for list overrides', () => {
        const doc = createDoc(['- existing']);
        const plan = computeListIndentPlan({
            doc,
            sourceBase: { indentWidth: 0, indentRaw: '' },
            targetLineNumber: 2,
            parseLineWithQuote: parse,
            getIndentUnitWidth: () => 2,
            listIntent: { mode: 'child' },
        });

        expect(plan.targetIndentWidth).toBe(2);
        expect(plan.indentDelta).toBe(2);
    });

    it('keeps source markers while adjusting list indentation', () => {
        const doc = createDoc(['- [ ] existing']);
        const sourceContent = '- parent\n  - child';

        const result = adjustListToTargetContext({
            doc,
            sourceContent,
            targetLineNumber: 2,
            parseLineWithQuote: parse,
            getIndentUnitWidth: () => 2,
            buildIndentStringFromSample: (sample, width) => buildIndentStringFromSample(sample, width, 4),
        });

        expect(result).toBe('- parent\n  - child');
    });
});
