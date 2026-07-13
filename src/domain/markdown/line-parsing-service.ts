import { Doc, ParsedLine } from './document-types';
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
    getIndentUnitWidthForDoc: (doc: Doc) => number;
    buildIndentStringFromSample: (sample: string, width: number) => string;
}

export function createLineParsingContext(tabSize: number): LineParsingContext {
    const unitTabSize = normalizeTabSize(tabSize);
    const getTabSize = () => unitTabSize;
    const parseLine = (line: string) => parseLineWithQuote(line, unitTabSize);
    return {
        getTabSize,
        parseLine,
        getIndentUnitWidth: (sample: string) => getIndentUnitWidth(sample, unitTabSize),
        getIndentUnitWidthForDoc: (doc: Doc) => getIndentUnitWidthForDoc(doc, parseLine),
        buildIndentStringFromSample: (sample: string, width: number) =>
            buildIndentStringFromSample(sample, width, unitTabSize),
    };
}
