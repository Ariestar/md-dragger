import { DocLike, ParsedLine } from './document-types';
import {
    buildIndentStringFromSample,
    getIndentUnitWidth,
    getIndentUnitWidthForDoc,
    normalizeTabSize,
    parseLineWithQuote,
} from './indent-calculator';

export interface LineParsingContext {
    getTabSize: () => number;
    parseLine: (line: string) => ParsedLine;
    getIndentUnitWidth: (sample: string) => number;
    getIndentUnitWidthForDoc: (doc: DocLike) => number;
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
        getIndentUnitWidthForDoc: (doc: DocLike) => getIndentUnitWidthForDoc(doc, parseLine, getTabSize()),
        buildIndentStringFromSample: (sample: string, width: number) => buildIndentStringFromSample(sample, width, getTabSize()),
    };
}
