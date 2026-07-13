import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import type { DropGuide, ListDropTarget } from '../command/drop-target';
import { BlockType } from '../block/block-types';
import { clampTargetLineNumber } from './line-target-number';
import { getLineMap, getLineMetaAt, getNearestListLineAtOrBefore, type LineMap } from './line-map';
import { computeListIntent } from './list-target';

// Pure drop-target resolution (vertical half-line + list intent + paint guide).
// No pixels. Adapter only maps guide line/char indices to screen coords.

export type DropLocateInput = {
  doc: Doc;
  selection: BlockSelection;
  /** 1-based line under pointer (or doc.lines+1 past end). */
  hitLine: number;
  /** Pointer in lower half of hit line. */
  belowMid: boolean;
  /** Pointer past list marker text — nest into this row. */
  pastMarker: boolean;
  /** Columns from a list line's marker to the pointer; null if not a list. */
  markerOffset: (listLine: number) => number | null;
  tabSize: number;
  indentUnit: number;
};

export type DropLocateResult = {
  targetLineNumber: number;
  placement: 'before';
  listIntent?: ListDropTarget;
  guide: DropGuide;
};

export function locateDropTarget(input: DropLocateInput): DropLocateResult | null {
  const {
    doc,
    selection,
    hitLine,
    belowMid,
    pastMarker,
    markerOffset,
    tabSize,
    indentUnit,
  } = input;

  if (hitLine < 1) {
    return {
      targetLineNumber: 1,
      placement: 'before',
      guide: buildGuide(doc, 1, 0, tabSize),
    };
  }
  if (hitLine > doc.lines) {
    const targetLine = doc.lines + 1;
    return {
      targetLineNumber: targetLine,
      placement: 'before',
      guide: buildGuide(doc, targetLine, 0, tabSize),
    };
  }

  const lineMap = getLineMap(doc, { tabSize });
  const hitMeta = getLineMetaAt(lineMap, hitLine);
  const nestHere = selection.anchorBlock.type === BlockType.ListItem
    && !!hitMeta?.isList
    && pastMarker;

  let targetLine = clampTargetLineNumber(
    doc.lines,
    belowMid ? hitLine + 1 : hitLine,
  );

  if (nestHere && !belowMid) {
    targetLine = clampTargetLineNumber(doc.lines, hitLine + 1);
  }

  const listIntent = listIntentAt({
    doc,
    lineMap,
    selection,
    hitLine,
    targetLine,
    nestHere,
    markerOffset,
    indentUnit,
  });

  const indent = listIntent?.targetIndentWidth ?? 0;

  return {
    targetLineNumber: targetLine,
    placement: 'before',
    listIntent,
    guide: buildGuide(doc, targetLine, indent, tabSize, lineMap),
  };
}

/**
 * Build paint guide: reuse an existing list line at the drop indent for left X.
 * No pixel math — only line numbers and a char offset into that line.
 */
export function buildGuide(
  doc: Doc,
  targetLine: number,
  indentWidth: number,
  tabSize: number,
  lineMap?: LineMap,
): DropGuide {
  const bandLine = targetLine <= 1 ? 1 : Math.min(targetLine - 1, doc.lines);
  const indent = Math.max(0, indentWidth);

  // Prefer a list item already at this indent — its content start IS the left edge.
  const map = lineMap ?? getLineMap(doc, { tabSize });
  const leftLine = findListLineAtIndent(map, indent) ?? bandLine;
  const leftChars = contentStartChars(doc.line(leftLine).text, indent, tabSize);

  return { bandLine, leftLine, leftChars };
}

function listIntentAt(params: {
  doc: Doc;
  lineMap: LineMap;
  selection: BlockSelection;
  hitLine: number;
  targetLine: number;
  nestHere: boolean;
  markerOffset: (listLine: number) => number | null;
  indentUnit: number;
}): ListDropTarget | undefined {
  const {
    doc,
    lineMap,
    selection,
    hitLine,
    targetLine,
    nestHere,
    markerOffset,
    indentUnit,
  } = params;

  if (selection.anchorBlock.type !== BlockType.ListItem) return undefined;

  const refLine = nestHere
    ? hitLine
    : getNearestListLineAtOrBefore(lineMap, targetLine - 1);
  if (refLine === null || refLine < 1) return undefined;

  const baseIndent = getLineMetaAt(lineMap, refLine)?.indentWidth;
  if (baseIndent === undefined) return undefined;

  const offset = markerOffset(refLine);
  if (offset === null) {
    return {
      mode: 'sibling',
      contextLineNumber: refLine,
      targetIndentWidth: baseIndent,
    };
  }

  const self = refLine === selection.anchorBlock.startLine + 1;
  const intent = computeListIntent({
    doc,
    lineMap,
    refLine,
    offset,
    indentUnit,
    allowChild: !self,
  });
  if (!intent) {
    return {
      mode: 'sibling',
      contextLineNumber: refLine,
      targetIndentWidth: baseIndent,
    };
  }

  let indent = Math.min(intent.targetIndentWidth, baseIndent + indentUnit);
  if (targetLine <= doc.lines) {
    const next = getLineMetaAt(lineMap, targetLine);
    if (next?.isList) {
      indent = Math.max(indent, Math.max(0, next.indentWidth - indentUnit));
    }
  }

  return {
    mode: intent.mode,
    contextLineNumber: intent.contextLineNumber,
    targetIndentWidth: indent,
  };
}

function findListLineAtIndent(lineMap: LineMap, indentWidth: number): number | null {
  for (let n = 1; n < lineMap.lineMeta.length; n += 1) {
    const meta = lineMap.lineMeta[n];
    if (meta?.isList && meta.indentWidth === indentWidth) return n;
  }
  return null;
}

/** Chars from line start to content edge after `indentWidth` columns (marker stays in). */
function contentStartChars(text: string, indentWidth: number, tabSize: number): number {
  // Skip blockquote prefix the same way line-parser does: leading `> ` runs.
  let i = 0;
  while (i < text.length) {
    const m = text.slice(i).match(/^\s*> ?/);
    if (!m) break;
    i += m[0].length;
  }
  let width = 0;
  let chars = i;
  while (chars < text.length && width < indentWidth) {
    const ch = text[chars];
    if (ch === ' ') {
      width += 1;
      chars += 1;
      continue;
    }
    if (ch === '\t') {
      width += tabSize;
      chars += 1;
      continue;
    }
    break;
  }
  return chars;
}
