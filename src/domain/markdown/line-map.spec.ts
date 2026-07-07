import { describe, expect, it } from 'vitest';
import type { DocLikeWithRange, StateWithDoc } from './document-types';
import {
    buildLineMap,
    getLineMap,
    getLineMetaAt,
    primeLineMapFromTransition,
} from './line-map';

type TestDoc = DocLikeWithRange & {
    lineAt: (pos: number) => { number: number };
    text: string;
};

type TestState = StateWithDoc & {
    doc: TestDoc;
};

type TestChangeDesc = {
    iterChanges(
        callback: (
            fromA: number,
            toA: number,
            fromB: number,
            toB: number,
            inserted: unknown
        ) => void
    ): void;
};

function createDoc(text: string): TestDoc {
    const lines = text.split('\n');
    const starts: number[] = [];
    let offset = 0;
    for (const line of lines) {
        starts.push(offset);
        offset += line.length + 1;
    }

    return {
        text,
        lines: lines.length,
        length: text.length,
        line: (n: number) => {
            const index = n - 1;
            const lineText = lines[index] ?? '';
            const from = starts[index] ?? text.length;
            return {
                text: lineText,
                from,
                to: from + lineText.length,
            };
        },
        lineAt: (pos: number) => {
            const clamped = Math.max(0, Math.min(text.length, pos));
            let lineNumber = 1;
            for (let i = 0; i < starts.length; i++) {
                if (starts[i] > clamped) break;
                lineNumber = i + 1;
            }
            return { number: lineNumber };
        },
        sliceString: (from: number, to: number) => text.slice(from, to),
    };
}

function createState(docText: string): TestState {
    return { doc: createDoc(docText) };
}

const TAB_SIZE = 4;

function updateState(
    state: TestState,
    change: { from: number; to: number; insert: string }
): { state: TestState; changes: TestChangeDesc } {
    const nextText = `${state.doc.text.slice(0, change.from)}${change.insert}${state.doc.text.slice(change.to)}`;
    return {
        state: createState(nextText),
        changes: {
            iterChanges: (callback) => {
                callback(
                    change.from,
                    change.to,
                    change.from,
                    change.from + change.insert.length,
                    change.insert
                );
            },
        },
    };
}

function nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

function percentile(samples: number[], p: number): number {
    if (samples.length === 0) return 0;
    const sorted = [...samples].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
    return Number(sorted[index].toFixed(3));
}

function summarizeDurations(samples: number[]): {
    count: number;
    p50: number;
    p95: number;
    max: number;
} {
    return {
        count: samples.length,
        p50: percentile(samples, 0.5),
        p95: percentile(samples, 0.95),
        max: percentile(samples, 1),
    };
}

describe('line-map', () => {
    it('uses explicit tab size supplied by the caller', () => {
        const state = createState('\t- child');
        const lineMap = getLineMap(state, { tabSize: 8 });

        expect(getLineMetaAt(lineMap, 1).indentWidth).toBe(8);
    });

    it('builds line metadata and non-empty indexes', () => {
        const state = createState('> [!note] title\n> body\n\n- item\n---\n| a |');
        const lineMap = getLineMap(state, { tabSize: TAB_SIZE });

        expect(getLineMetaAt(lineMap, 1)).toEqual(expect.objectContaining({
            isQuote: true,
            isCallout: true,
            isEmpty: false,
        }));
        expect(getLineMetaAt(lineMap, 3)).toEqual(expect.objectContaining({
            isEmpty: true,
        }));
        expect(getLineMetaAt(lineMap, 4)).toEqual(expect.objectContaining({
            isList: true,
        }));
        expect(getLineMetaAt(lineMap, 5)).toEqual(expect.objectContaining({
            isHr: true,
        }));
        expect(getLineMetaAt(lineMap, 6)).toEqual(expect.objectContaining({
            isTable: true,
        }));
        expect(lineMap.prevNonEmpty[3]).toBe(2);
        expect(lineMap.nextNonEmpty[3]).toBe(4);
    });

    it('builds list parent/subtree indexes', () => {
        const state = createState('- root\n  - child\n    detail\n- sibling\nafter');
        const lineMap = getLineMap(state, { tabSize: TAB_SIZE });

        expect(lineMap.listParentLine[1]).toBe(0);
        expect(lineMap.listParentLine[2]).toBe(1);
        expect(lineMap.listSubtreeEndLine[2]).toBe(3);
        expect(lineMap.listSubtreeEndLine[1]).toBe(3);
        expect(lineMap.prevListLine[4]).toBe(2);
        expect(lineMap.prevListLine[5]).toBe(4);
    });

    it('reuses cached line map across states sharing the same doc', () => {
        const stateA = createState('- item');
        const first = getLineMap(stateA, { tabSize: TAB_SIZE });
        const stateB = { doc: stateA.doc };
        const second = getLineMap(stateB, { tabSize: TAB_SIZE });
        const stateC = createState('- item\n- next');

        expect(first).toBe(second);
        expect(getLineMap(stateC, { tabSize: TAB_SIZE })).not.toBe(first);
    });

    it('primes next line map from transition changes and matches full build output', () => {
        const previousState = createState('- root\n- sibling\nplain');
        const previousMap = getLineMap(previousState, { tabSize: TAB_SIZE });
        expect(previousMap.doc.lines).toBe(3);

        const tr = updateState(previousState, {
            from: previousState.doc.line(2).to,
            to: previousState.doc.line(2).to,
            insert: '\n  - child',
        });
        const nextState = tr.state;

        const primed = primeLineMapFromTransition({
            previousState,
            nextState,
            changes: tr.changes,
            tabSize: TAB_SIZE,
        });
        const rebuilt = buildLineMap(nextState, { tabSize: TAB_SIZE });

        expect(primed.doc).toBe(nextState.doc);
        expect(primed.lineMeta).toEqual(rebuilt.lineMeta);
        expect(Array.from(primed.prevNonEmpty)).toEqual(Array.from(rebuilt.prevNonEmpty));
        expect(Array.from(primed.nextNonEmpty)).toEqual(Array.from(rebuilt.nextNonEmpty));
        expect(Array.from(primed.prevListLine)).toEqual(Array.from(rebuilt.prevListLine));
        expect(Array.from(primed.listParentLine)).toEqual(Array.from(rebuilt.listParentLine));
        expect(Array.from(primed.listSubtreeEndLine)).toEqual(Array.from(rebuilt.listSubtreeEndLine));
        expect(getLineMap(nextState, { tabSize: TAB_SIZE })).toBe(primed);
    });

    it('reuses index arrays when typing does not change structural metadata', () => {
        const previousState = createState('- item\nplain text\n> quote');
        const previous = getLineMap(previousState, { tabSize: TAB_SIZE });
        const tr = updateState(previousState, {
            from: previousState.doc.line(2).to,
            to: previousState.doc.line(2).to,
            insert: '!',
        });
        const next = primeLineMapFromTransition({
            previousState,
            nextState: tr.state,
            changes: tr.changes,
            tabSize: TAB_SIZE,
        });

        expect(next.prevNonEmpty).toBe(previous.prevNonEmpty);
        expect(next.nextNonEmpty).toBe(previous.nextNonEmpty);
        expect(next.prevListLine).toBe(previous.prevListLine);
        expect(next.listParentLine).toBe(previous.listParentLine);
        expect(next.listSubtreeEndLine).toBe(previous.listSubtreeEndLine);
    });

    it('typing performance smoke test logs stats to console', () => {
        const docLinesRaw = Number(process.env.DRAGGER_TYPING_PERF_LINES ?? 12000);
        const iterationsRaw = Number(process.env.DRAGGER_TYPING_PERF_ITERS ?? 120);
        const docLines = Number.isFinite(docLinesRaw) && docLinesRaw > 100 ? Math.floor(docLinesRaw) : 12000;
        const iterations = Number.isFinite(iterationsRaw) && iterationsRaw > 0 ? Math.floor(iterationsRaw) : 120;

        const sourceLines: string[] = [];
        for (let i = 1; i <= docLines; i++) {
            if (i % 9 === 0) {
                sourceLines.push(`> quote line ${i}`);
            } else if (i % 5 === 0) {
                sourceLines.push(`- [ ] list item ${i}`);
            } else {
                sourceLines.push(`plain line ${i}`);
            }
        }

        let state = createState(sourceLines.join('\n'));
        getLineMap(state, { tabSize: TAB_SIZE });

        const totalDurations: number[] = [];
        const primeDurations: number[] = [];
        const getDurations: number[] = [];

        for (let i = 0; i < iterations; i++) {
            const lineNumber = 1 + (i % docLines);
            const line = state.doc.line(lineNumber);
            const insert = i % 2 === 0 ? 'a' : 'b';
            const totalStartedAt = nowMs();
            const tr = updateState(state, {
                from: line.to,
                to: line.to,
                insert,
            });

            const primeStartedAt = nowMs();
            const primed = primeLineMapFromTransition({
                previousState: state,
                nextState: tr.state,
                changes: tr.changes,
                tabSize: TAB_SIZE,
            });
            primeDurations.push(nowMs() - primeStartedAt);

            const getStartedAt = nowMs();
            const cached = getLineMap(tr.state, { tabSize: TAB_SIZE });
            getDurations.push(nowMs() - getStartedAt);
            totalDurations.push(nowMs() - totalStartedAt);

            expect(cached).toBe(primed);
            state = tr.state;
        }

        const report = {
            docLines,
            iterations,
            total: summarizeDurations(totalDurations),
            prime: summarizeDurations(primeDurations),
            get: summarizeDurations(getDurations),
        };

        console.debug('[Dragger][PerfTest] typing_line_map', JSON.stringify(report, null, 2));

        expect(report.total.count).toBe(iterations);
        expect(report.prime.p95).toBeGreaterThanOrEqual(0);
        expect(report.get.p95).toBeGreaterThanOrEqual(0);
    });
});
