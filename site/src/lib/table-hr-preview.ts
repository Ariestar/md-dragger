import {
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from '@codemirror/view';

// Host-owned table / HR preview for the rich-text demo.
//
// Does NOT use syntaxTree. ink-mde and the site can end up with different
// @codemirror/language copies under Vite; syntaxTree() then sees an empty tree
// while ink-mde's own katex widgets (same copy as the language) still work.
// Scanning the doc text is the reliable host path — same visual idea as math:
// rendered block above, source lines dimmed below.

export function tableAndRulePreview(): Extension {
  return [tableHrField, theme];
}

const tableHrField = StateField.define<DecorationsSet>({
  create: (state) => build(state),
  update(deco, tr) {
    if (tr.docChanged) return build(tr.state);
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

function build(state: EditorState): DecorationSet {
  const out: Range<Decorations>[] = [];
  const lines = state.doc;
  let i = 1;

  while (i <= lines.lines) {
    const line = lines.line(i);
    const text = line.text.trim();

    if (isHorizontalRule(text)) {
      out.push(
        Decrations.widget({
          widget: new RuleWidget(),
          block: true,
          side: -1,
        }).range(line.from),
      );
      out.push(Decorations.line({ class: 'md-rule-source' }).range(line.from));
      i += 1;
      continue;
    }

    if (isTableRow(text) && i + 1 <= lines.lines) {
      const next = lines.line(i + 1).text.trim();
      if (isAlignRow(next)) {
        const start = i;
        let end = i + 1;
        while (end + 1 <= lines.lines && isTableRow(lines.line(end + 1).text.trim())) {
          end += 1;
        }
        const from = lines.line(start).from;
        const to = lines.line(end).to;
        const source = state.doc.sliceString(from, to);
        out.push(
          Decrations.widget({
            widget: new TableWidget(source),
            block: true,
            side: -1,
          }).range(from),
        );
        for (let n = start; n <= end; n += 1) {
          out.push(
            Decorations.line({ class: 'md-table-source' }).range(lines.line(n).from),
          );
        }
        i = end + 1;
        continue;
      }
    }

    i += 1;
  }

  out.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide);
  return Decrations.set(out, true);
}

function isHorizontalRule(text: string): boolean {
  // --- or *** or ___ (optional spaces), not a table separator
  return /^(?:-{3,}|\*{3,}|_{3,})$/.test(text);
}

function isTableRow(text: string): boolean {
  return text.includes('|') && !isAlignRow(text);
}

function isAlignRow(text: string): boolean {
  if (!text.includes('-')) return false;
  const parts = splitCells(text);
  return parts.length > 0 && parts.every((c) => /^:?-{3,}:?$/.test(c.trim()));
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

    const rows = this.source.split('\n').map((l) => l.trim()).filter(Boolean);
    let aligns: Align[] = [];
    let body = false;

    for (const row of rows) {
      if (isAlignRow(row)) {
        aligns = parseAligns(row);
        body = true;
        continue;
      }
      const tr = document.createElement('tr');
      const tag = body ? 'td' : 'th';
      splitCells(row).forEach((cell, i) => {
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
