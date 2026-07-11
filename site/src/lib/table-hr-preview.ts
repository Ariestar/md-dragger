import type { Extension } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';

// Minimal host preview for GFM nodes ink-mde already parses but does not paint:
// Table and HorizontalRule. Math is handled by ink-mde's own katex plugins
// (enabled with katex: true) — do not reimplement it here.

export function tableAndRulePreview(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(update: ViewUpdate) {
          if (update.docChanged || update.viewportChanged) {
            this.decorations = build(update.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    theme,
  ];
}

function build(view: EditorView): DecorationSet {
  const ranges: ReturnType<ReturnType<typeof Decoration.widget>['range']>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        if (node.name === 'Table') {
          ranges.push(
            Decrations.widget({
              widget: new TableWidget(view.state.doc.sliceString(node.from, node.to)),
              block: true,
              side: -1,
            }).range(node.from),
          );
          return false;
        }
        if (node.name === 'HorizontalRule') {
          ranges.push(
            Decrations.widget({
              widget: new RuleWidget(),
              block: true,
              side: -1,
            }).range(node.from),
          );
          return false;
        }
      },
    });
  }
  return Decoration.set(ranges, true);
}

class TableWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }
  eq(other: TableWidget) {
    return other.source === this.source;
  }
  toDOM() {
    const wrap = document.createElement('div');
    wrap.className = 'md-table-preview';
    wrap.contentEditable = 'false';
    const table = document.createElement('table');
    let headerDone = false;
    for (const line of this.source.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (isAlign(trimmed)) {
        headerDone = true;
        continue;
      }
      const tr = document.createElement('tr');
      const tag = headerDone ? 'td' : 'th';
      for (const cell of cells(trimmed)) {
        const el = document.createElement(tag);
        el.textContent = cell.trim();
        tr.appendChild(el);
      }
      table.appendChild(tr);
      headerDone = true;
    }
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

class RuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement('hr');
    el.className = 'md-rule-preview';
    el.contentEditable = 'false';
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function isAlign(line: string): boolean {
  return cells(line).every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

function cells(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|');
}

const theme = EditorView.baseTheme({
  '.md-table-preview': {
    padding: '0.4rem 0',
    overflowX: 'auto',
  },
  '.md-table-preview table': {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.92em',
  },
  '.md-table-preview th, .md-table-preview td': {
    border: '1px solid color-mix(in oklch, currentColor 18%, transparent)',
    padding: '0.35rem 0.6rem',
    textAlign: 'left',
  },
  '.md-table-preview th': {
    background: 'color-mix(in oklch, currentColor 8%, transparent)',
    fontWeight: '600',
  },
  '.md-rule-preview': {
    border: '0',
    height: '1px',
    margin: '0.75rem 0',
    background: 'color-mix(in oklch, currentColor 22%, transparent)',
  },
});
