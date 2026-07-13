import { Doc, ParsedLine } from './document-types';
import { buildIndentStringFromSample, getIndentUnitWidth, getIndentUnitWidthForDoc, normalizeTabSize, parseLineWithQuote } from './indent-calculator';

export interface LineParsingContext {
    getTabSize: () => number;
    parseLine: (line: string) => ParsedLine;
    getIndentUnitWidth: (sample: string) => number;
    getIndentUnitWidthForDoc: (doc: Doc) => number;
    buildIndentStringFromSample: (sample: string, width: number) => string;
}

export function createLineParsingContext(tabSize: number): LineParsingContext {
    const normalizedTabSize = normalizeTabSize(tabSize);
    const getTabSize = () => normalizedTabSize;
    const parseLine = (line: string) => parseLineWithQuote(line, getTabSize());
    return {
        getTabSize,
        parseLine,
        getIndentUnitWidth: (sample: string) => getIndentUnitWidth(sample, getTabSize()),
        getIndentUnitWidthForDoc: (doc: Doc) => getIndentUnitWidthForDoc(doc, parseLine),
        buildIndentStringFromSample: (sample: string, width: number) => buildIndentStringFromSample(sample, width, getTabSize()),
    };
}
