import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { syntaxTree } from '@codemirror/language';
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';

// Preview for GFM Table / HorizontalRule.
// StateField rebuilds on reconfigure (language load) — same as ink-mde katex.
// A ViewPlugin that only watched docChanged stayed empty after grammar load.

export function tableAndRulePreview(): Extension {
  return [tableHrField, theme];
}

const tableHrField = StateField.define<DecorationsSet>({
  create: (state) => build(state),
  update(deco, tr) {
    if (tr.docChanged || tr.reconfigured) return build(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function build(state: EditorState): DecorationSet {
  const out: Range<Decorations>[] = [];

  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === 'Table') {
        out.push(
          Decrations.widget({
            widget: new TableWidget(state.doc.sliceString(node.from, node.to)),
            block: true,
            side: -1,
          }).range(node.from),
        );
        markSourceLines(state, node.from, node.to, 'md-table-source', out);
        return false;
      }
      if (node.name === 'HorizontalRule') {
        out.push(
          Decrations.widget({
            widget: new RuleWidget(),
            block: true,
            side: -1,
          }).range(node.from),
        );
        markSourceLines(state, node.from, node.to, 'md-rule-source', out);
        return false;
      }
    },
  });

  out.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  return Decoration.set(out, true);
}

function markSourceLines(
  state: EditorState,
  from: number,
  to: number,
  className: string,
  out: Range<Decorations>[],
): void {
  let pos = from;
  while (pos < to) {
    const line = state.doc.lineAt(pos);
    out.push(Decorations.line({ class: className }).range(line.from));
    if (line.to >= state.doc.length) break;
    pos = line.to + 1;
  }
}

type Align = 'left' | 'center' | 'right';

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

    const lines = this.source.split('\n').map((l) => l.trim()).filter(Boolean);
    let aligns: Align[] = [];
    let body = false;

    for (const line of lines) {
      if (isAlignRow(line)) {
        aligns = parseAligns(line);
        body = true;
        continue;
      }
      const tr = document.createElement('tr');
      const tag = body ? 'td' : 'th';
      splitCells(line).forEach((cell, i) => {
        const el = document.createElement(tag);
        el.textContent = cell.trim();
        const align = aligns[i] ?? 'left';
        if (align !== 'left') el.style.textAlign = align;
        tr.appendChild(el);
      });
      table.appendChild(tr);
      body = true;
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

function isAlignRow(line: string): boolean {
  const parts = splitCells(line);
  return parts.length > 0 && parts.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

function parseAligns(line: string): Align[] {
  return splitCells(line).map((c) => {
    const t = c.trim();
    const left = t.startsWith(':');
    const right = t.endsWith(':');
    if (left && right) return 'center';
    if (right) return 'right';
    return 'left';
  });
}

function splitCells(line: string): string[] {
  return line.replace(/^\|/, '').replace(/\|$/, '').split('|');
}

const theme = EditorView.baseTheme({
  '.md-table-preview': {
    padding: '0.35rem 0 0.15rem',
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
  },
  '.md-table-preview th': {
    background: 'color-mix(in oklch, currentColor 8%, transparent)',
    fontWeight: '600',
  },
  '.md-table-source, .md-rule-source': {
    opacity: '0.4',
    fontSize: '0.85em',
  },
  '.md-rule-preview': {
    border: '0',
    height: '1px',
    margin: '0.6rem 0 0.15rem',
    background: 'color-mix(in oklch, currentColor 22%, transparent)',
  },
});
