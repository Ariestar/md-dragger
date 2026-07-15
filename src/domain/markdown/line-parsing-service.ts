import type { Doc } from './document-types';
import type { ParsedLine } from '../parse/types';
import { formatIndent, parseLine } from '../parse/parse-line';
import {
    getIndentUnitWidth,
    getIndentUnitWidthForDoc,
    normalizeTabSize,
} from './indent-calculator';

export interface LineParsingContext {
    getTabSize: () => number;
    parseLine: (line: string) => ParsedLine;
    getIndentUnitWidth: (sample: string) => number;
    getIndentUnitWidthForDoc: (doc: Doc) => number;
    buildIndentStringFromSample: (sample: string, width: number) => string;
}

/** Binds tabSize for callers that want a closure. Prefer parseLine(text, tabSize). */
export function createLineParsingContext(tabSize: number): LineParsingContext {
    const unitTabSize = normalizeTabSize(tabSize);
    const parse = (line: string) => parseLine(line, unitTabSize);
    return {
        getTabSize: () => unitTabSize,
        parseLine: parse,
        getIndentUnitWidth: (sample: string) => getIndentUnitWidth(sample, unitTabSize),
        getIndentUnitWidthForDoc: (doc: Doc) => getIndentUnitWidthForDoc(doc, parse),
        buildIndentStringFromSample: (sample: string, width: number) =>
            formatIndent(width, unitTabSize, sample),
    };
}
