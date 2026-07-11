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
import { styleTags, tags } from '@lezer/highlight';
import type { MarkdownConfig } from '@lezer/markdown';
import { plugin, pluginTypes, type Options } from 'ink-mde';
import katex from 'katex';

// Host-owned hybrid markdown for the website demo.
// ink-mde parses GFM (tables, HR) but does not render them; math only works if
// its internal katex() default plugins survive. Own both the math grammar and
// the block widgets here so the demo is explicit and self-contained.

const DOLLAR = 36; // '$'

/** ink-mde grammar plugins: math block/inline nodes. */
export function hybridMarkdownInkPlugins(): Options.Plugin[] {
  return [
    plugin({
      type: pluginTypes.grammar,
      value: () => mathGrammar,
    }),
  ];
}

/** CodeMirror extensions: render math / table / HR from the syntax tree. */
export function hybridMarkdown(): Extension {
  return [
    ViewPlugin.fromClass(
      class {
        decorations: DecorationSet;
        constructor(view: EditorView) {
          this.decorations = build(view);
        }
        update(update: ViewUpdate) {
          if (
            update.docChanged
            || update.viewportChanged
            || syntaxTree(update.startState) !== syntaxTree(update.state)
          ) {
            this.decorations = build(update.view);
          }
        }
      },
      { decorations: (v) => v.decorations },
    ),
    theme,
  ];
}

// --- grammar -----------------------------------------------------------------

const mathGrammar: MarkdownConfig = {
  defineNodes: [
    { name: 'MathBlock', block: true },
    { name: 'MathBlockMark' },
    { name: 'MathInline' },
    { name: 'MathInlineMark' },
  ],
  parseBlock: [
    {
      name: 'MathBlock',
      parse(cx, line) {
        if (line.next !== DOLLAR || line.text.charCodeAt(line.pos + 1) !== DOLLAR) {
          return false;
        }
        const openFrom = cx.lineStart + line.pos;
        const openTo = openFrom + line.text.length - line.pos;
        while (cx.nextLine()) {
          if (line.next === DOLLAR && line.text.charCodeAt(line.pos + 1) === DOLLAR) {
            const closeFrom = cx.lineStart + line.pos;
            const closeTo = closeFrom + line.text.length - line.pos;
            cx.addElement(
              cx.elt('MathBlock', openFrom, closeTo, [
                cx.elt('MathBlockMark', openFrom, openTo),
                cx.elt('MathBlockMark', closeFrom, closeTo),
              ]),
            );
            cx.nextLine();
            return true;
          }
        }
        return false;
      },
    },
  ],
  parseInline: [
    {
      name: 'MathInline',
      parse(cx, next, pos) {
        if (next !== DOLLAR) return -1;
        // Don't steal the opening of a $$ block.
        if (cx.char(pos + 1) === DOLLAR) return -1;
        let end = pos + 1;
        while (end < cx.end) {
          const ch = cx.char(end);
          if (ch === DOLLAR) {
            if (end === pos + 1) return -1;
            return cx.addElement(
              cx.elt('MathInline', pos, end + 1, [
                cx.elt('MathInlineMark', pos, pos + 1),
                cx.elt('MathInlineMark', end, end + 1),
              ]),
            );
          }
          if (ch === 10 /* \n */) return -1;
          end += 1;
        }
        return -1;
      },
    },
  ],
  props: [
    styleTags({
      MathBlock: tags.monospace,
      MathBlockMark: tags.processingInstruction,
      MathInline: tags.monospace,
      MathInlineMark: tags.processingInstruction,
    }),
  ],
};

// --- decorations -------------------------------------------------------------

function build(view: EditorView): DecorationSet {
  const out: ReturnType<ReturnType<typeof Decoration.widget>['range']>[] = [];

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(view.state).iterate({
      from,
      to,
      enter(node) {
        switch (node.name) {
          case 'Table': {
            const source = view.state.doc.sliceString(node.from, node.to);
            out.push(
              Decoration.widget({
                widget: new TableWidget(source),
                block: true,
                side: -1,
              }).range(node.from),
            );
            return false;
          }
          case 'HorizontalRule': {
            out.push(
              Decoration.widget({
                widget: new HrWidget(),
                block: true,
                side: -1,
              }).range(node.from),
            );
            return false;
          }
          case 'MathBlock': {
            const tex = mathBody(view.state.doc.sliceString(node.from, node.to), true);
            out.push(
              Decoration.widget({
                widget: new MathWidget(tex, true),
                block: true,
                side: -1,
              }).range(node.from),
            );
            return false;
          }
          case 'MathInline': {
            const tex = mathBody(view.state.doc.sliceString(node.from, node.to), false);
            out.push(
              Decrations.widget({
                widget: new MathWidget(tex, false),
                side: 1,
              }).range(node.to),
            );
            return false;
          }
          default:
            return undefined;
        }
      },
    });
  }

  return Decoration.set(out.sort((a, b) => a.from - b.from || a.value.startSide - b.value.startSide), true);
}

function mathBody(raw: string, block: boolean): string {
  if (block) {
    const lines = raw.split('\n');
    if (lines.length >= 2) return lines.slice(1, -1).join('\n');
    return raw.slice(2, -2);
  }
  return raw.slice(1, -1);
}

// --- widgets -----------------------------------------------------------------

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(other: MathWidget) {
    return other.tex === this.tex && other.display === this.display;
  }
  toDOM() {
    const el = document.createElement(this.display ? 'div' : 'span');
    el.className = this.display ? 'md-hybrid-math-block' : 'md-hybrid-math-inline';
    el.contentEditable = 'false';
    katex.render(this.tex, el, { displayMode: this.display, throwOnError: false, output: 'html' });
    return el;
  }
  ignoreEvent() {
    return true;
  }
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
    wrap.className = 'md-hybrid-table-wrap';
    wrap.contentEditable = 'false';

    const table = document.createElement('table');
    table.className = 'md-hybrid-table';

    const rows = this.source.split('\n').map((l) => l.trim()).filter(Boolean);
    let sawBody = false;
    for (const row of rows) {
      if (isAlignRow(row)) {
        sawBody = true;
        continue;
      }
      const tr = document.createElement('tr');
      const cellTag = sawBody ? 'td' : 'th';
      for (const cell of splitCells(row)) {
        const td = document.createElement(cellTag);
        td.textContent = cell.trim();
        tr.appendChild(td);
      }
      table.appendChild(tr);
      sawBody = true;
    }
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

class HrWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    const el = document.createElement('hr');
    el.className = 'md-hybrid-hr';
    el.contentEditable = 'false';
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function isAlignRow(line: string): boolean {
  const cells = splitCells(line);
  return cells.length > 0 && cells.every((c) => /^:?-{3,}:?$/.test(c.trim()));
}

function splitCells(line: string): string[] {
  const body = line.replace(/^\|/, '').replace(/\|$/, '');
  return body.split('|');
}

// --- theme -------------------------------------------------------------------

const theme = EditorView.baseTheme({
  '.md-hybrid-math-block': {
    display: 'block',
    padding: '0.4rem 0.6rem',
    margin: '0.25rem 0',
    overflowX: 'auto',
    backgroundColor: 'var(--ink-internal-block-background-color, transparent)',
    borderRadius: 'var(--ink-internal-border-radius, 0.25rem)',
  },
  '.md-hybrid-math-inline': {
    display: 'inline-block',
    marginInline: '0.15em',
    verticalAlign: 'middle',
  },
  '.md-hybrid-table-wrap': {
    padding: '0.4rem 0',
    overflowX: 'auto',
  },
  '.md-hybrid-table': {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: '0.92em',
  },
  '.md-hybrid-table th, .md-hybrid-table td': {
    border: '1px solid color-mix(in oklch, currentColor 18%, transparent)',
    padding: '0.35rem 0.6rem',
    textAlign: 'left',
  },
  '.md-hybrid-table th': {
    background: 'color-mix(in oklch, currentColor 8%, transparent)',
    fontWeight: '600',
  },
  '.md-hybrid-hr': {
    border: '0',
    height: '1px',
    margin: '0.75rem 0',
    background: 'color-mix(in oklch, currentColor 22%, transparent)',
  },
});
