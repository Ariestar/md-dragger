import type { BlockSelection } from '../selection/block-selection';
import type { Doc } from './document-types';
import type { ListDropTarget } from '../command/drop-target';
import { BlockType } from '../block/block-types';
import { clampTargetLineNumber } from './line-target-number';
import { getLineMap, getLineMetaAt, getNearestListLineAtOrBefore, type LineMap } from './line-map';
import { computeListIntent } from './list-target';

// Pure drop-target resolution (vertical half-line + list intent).
// Adapter measures pixels; this module owns document rules.

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
    return { targetLineNumber: 1, placement: 'before' };
  }
  if (hitLine > doc.lines) {
    return { targetLineNumber: doc.lines + 1, placement: 'before' };
  }

  const lineMap = getLineMap(doc, { tabSize });
  const hitMeta = getLineMetaAt(lineMap, hitLine);
  const nestHere = selection.anchorBlock.type === BlockType.ListItem
    && !!hitMeta?.isList
    && pastMarker;

  // Half-line: upper → before hit, lower → after hit.
  let targetLine = clampTargetLineNumber(
    doc.lines,
    belowMid ? hitLine + 1 : hitLine,
  );

  // Nest into hovered row: force insertion after it.
  if (nestHere && !belowMid) {
    targetLine = clampTargetLineNumber(doc.lines, hitLine + 1);
  }

  return {
    targetLineNumber: targetLine,
    placement: 'before',
    listIntent: listIntentAt({
      doc,
      lineMap,
      selection,
      hitLine,
      targetLine,
      nestHere,
      markerOffset,
      indentUnit,
    }),
  };
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

  // Reference list for indent slots:
  //   nest → hovered row
  //   else → nearest list at or before the line above the seam
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

  // Cap: at most one nest under ref; at least one step above the next list.
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
