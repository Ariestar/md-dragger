import type { Doc } from './document-types';
import type { LineMap } from './line-map';
import { getLineMetaAt, listLineAtOrAbove } from './line-map';

// List drop intent — pure column-space logic.
// Adapter measures pixels into `offset` + `indentUnit`;
// this module picks nearest child / sibling / outdent slot.

export type ListIntentMode = 'child' | 'sibling' | 'outdent';

export type ListIntent = {
  mode: ListIntentMode;
  contextLineNumber: number;
  targetIndentWidth: number;
};

export type ComputeListIntentParams = {
  doc: Doc;
  lineMap: LineMap;
  /** List line used as the indent baseline. */
  refLine: number;
  /** Columns relative to that line's marker start. */
  offset: number;
  /** Columns per indent step (host config listIndentUnit). */
  indentUnit: number;
  allowChild: boolean;
};

// Slots (columns relative to the reference marker):
//   sibling  offset 0
//   child    offset +indentUnit   (if allowChild)
//   outdent  offset -(base - ancestor) for each ancestor
export function computeListIntent(params: ComputeListIntentParams): ListIntent | null {
  const { doc, lineMap, refLine, offset, indentUnit, allowChild } = params;
  if (refLine < 1 || refLine > doc.lines) return null;

  const baseIndent = listIndent(lineMap, refLine);
  if (baseIndent === undefined) return null;

  type Slot = { offset: number; line: number; indent: number; mode: ListIntentMode };
  const slots: Slot[] = [
    { offset: 0, line: refLine, indent: baseIndent, mode: 'sibling' },
  ];

  if (allowChild) {
    slots.push({
      offset: indentUnit,
      line: refLine,
      indent: baseIndent + indentUnit,
      mode: 'child',
    });
  }

  for (const ancestor of listAncestors(doc, refLine, lineMap)) {
    if (ancestor === refLine) continue;
    const ancestorIndent = listIndent(lineMap, ancestor);
    if (ancestorIndent === undefined || ancestorIndent >= baseIndent) continue;
    slots.push({
      offset: -(baseIndent - ancestorIndent),
      line: ancestor,
      indent: ancestorIndent,
      mode: 'outdent',
    });
  }

  let best = slots[0];
  let bestDist = Math.abs(offset - best.offset);
  for (let i = 1; i < slots.length; i++) {
    const dist = Math.abs(offset - slots[i].offset);
    if (dist < bestDist) {
      best = slots[i];
      bestDist = dist;
    }
  }

  return {
    mode: best.mode,
    contextLineNumber: best.line,
    targetIndentWidth: best.indent,
  };
}

/** Ancestor list lines above `line` (enclosing items, root last). */
export function listAncestors(doc: Doc, line: number, lineMap: LineMap): number[] {
  const result: number[] = [];
  const clamped = Math.max(1, Math.min(line, doc.lines));
  let cursor = subtreeRoot(clamped, lineMap);
  while (cursor !== null && cursor > 0) {
    result.push(cursor);
    const parent = lineMap.listParentLine[cursor];
    cursor = parent > 0 ? parent : null;
  }
  return result;
}

/** List subtree root covering `line` (or nearest list above). */
export function listRoot(line: number, lineMap: LineMap): number | null {
  return subtreeRoot(line, lineMap);
}

function subtreeRoot(line: number, lineMap: LineMap): number | null {
  const nearest = listLineAtOrAbove(lineMap, line);
  if (nearest === null) return null;
  let cursor = nearest;
  while (cursor > 0) {
    if (lineMap.listSubtreeEndLine[cursor] >= line) return cursor;
    cursor = lineMap.listParentLine[cursor];
  }
  return null;
}

function listIndent(lineMap: LineMap, line: number): number | undefined {
  const meta = getLineMetaAt(lineMap, line);
  if (!meta || !meta.isList) return undefined;
  return meta.indentWidth;
}
