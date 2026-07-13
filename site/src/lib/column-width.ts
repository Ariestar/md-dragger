import type { EditorView } from '@codemirror/view';

// Host-owned column metric for this demo editor.
// Adapter never estimates: host must pass columnWidthPx into mdDragger / dropSeam.
// Markdown indent is spaces — measure one real space under the live font.

export function demoColumnWidthPx(view: EditorView): number {
  const doc = view.state.doc;
  for (let n = 1; n <= doc.lines; n += 1) {
    const line = doc.line(n);
    const i = line.text.indexOf(' ');
    if (i < 0) continue;
    const a = view.coordsAtPos(line.from + i, 1);
    const b = view.coordsAtPos(line.from + i + 1, 1);
    if (a && b && b.left > a.left) return b.left - a.left;
  }
  throw new Error('demoColumnWidthPx: document has no space to measure');
}
