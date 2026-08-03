import type { MarkerType } from '../markdown/document-types';

/** Indent: one shape everywhere. */
export type Indent = {
    raw: string;
    width: number;
};

/**
 * Leading line marker (mutually exclusive kinds).
 * Quote is NOT here — it stacks with list/heading.
 */
export type LineMarker =
    | {
          kind: 'list';
          text: string;
          markerType: MarkerType;
          checked?: boolean;
      }
    | {
          kind: 'heading';
          text: string;
          level: 1 | 2 | 3 | 4 | 5 | 6;
      }
    | { kind: 'hr'; text: string }
    | {
          kind: 'fence';
          text: string;
          fence: 'code' | 'math';
          info?: string;
      }
    | { kind: 'table-row'; text: string }
    | {
          kind: 'callout';
          text: string;
          calloutType: string;
      };

/**
 * One line of MD structure. Not DocLine (no from/to).
 * Rewrite: quote.prefix + formatIndent(...) + marker?.text + body
 */
export type ParsedLine = {
    raw: string;
    quote: {
        depth: number;
        prefix: string;
    };
    indent: Indent;
    marker: LineMarker | null;
    body: string;
};
