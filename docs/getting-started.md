# Getting started

md-dragger offers two integration levels:

1. **CodeMirror 6 adapter** (`md-dragger/adapter/codemirror`) — the fastest path if your editor is CM6. `mdDragger()` returns ready-made extensions.
2. **Headless runtime** (`md-dragger/runtime`) — drive `DraggerRuntime` yourself with any input/document/locate/commit hosts.

Both share the same engine, so behavior (block detection, nesting, container rules, list renumbering, cross-doc moves) is identical.

---

## Level 1: CodeMirror 6 adapter

### Minimal setup

```ts
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { mdDragger } from 'md-dragger/adapter/codemirror';

const extensions = mdDragger({
    // Required — no silent defaults.
    config: { tabSize: 4, listIndentUnit: 4 },
    // Required — rendered pixel width of one list nesting level. Measure it
    // from your theme so x-axis drag steps match the rendered indent.
    listIndentWidthPx: 36,
});

const view = new EditorView({
    parent: document.body,
    state: EditorState.create({ doc: '# Title\n\n- a\n- b', extensions }),
});
```

That's it: each block gets a handle, dragging works, drops commit as a single undoable transaction.

### Full option map

See [api-reference.md](api-reference.md#mddraggercodemirroroptions) for every field. The commonly used ones:

```ts
mdDragger({
    config: { tabSize: 4, listIndentUnit: 4 },
    listIndentWidthPx: (view) => measureIndentStep(view),

    handle: {
        // Custom handle DOM (button semantics). Default: a plain ⋮⋮ button.
        render: () => makeHandle(),
        // Gutter side: 'before' (left) or 'after' (right).
        side: 'before',
    },

    locate: (view) => ({
        // Optional overrides for source-line resolution / drop position.
        // Only needed for host-specific hit-testing (e.g. Obsidian mobile
        // "row as handle" mode).
    }),

    ux: {
        gesture: {
            dragArmMs: 0,
            multiSelectMs: 500,
            dragStartMoveThresholdPx: 4,
        },
        modules: [autoScroll(...)],
    },

    onChange: (result) => { /* observe pipeline transitions */ },
});
```

### Excluding views with `enabled`

Some editors host **nested CodeMirror views that are not real documents** — for example, Obsidian's Live Preview opens a transient CM6 editor inside a focused table cell to edit its text. The dragger must stay dormant there.

```ts
mdDragger({
    config: { tabSize: 4, listIndentUnit: 4 },
    listIndentWidthPx: 36,
    enabled: (view) => view.dom.closest('.cm-table-widget') === null,
});
```

The predicate is re-checked **per render and per press**, because such nested editors are constructed detached and only become identifiable once attached into their host widget. Keep it cheap and DOM-based.

### What the host must render

The adapter produces:

- a zero-width gutter (`md-dragger-gutter`) with handle markers (`md-dragger-handle`, carrying `data-block-start`),
- line decorations for the drag source (`md-dragger-drag-source`), the drop seam (`md-dragger-drop-seam`, `-top`/`-below`), and an invalid-state class (`is-invalid`),
- CSS variables hosts fill from adapter geometry (`--d-source-level` per row, seam offset variables from `seamOffset()`).

Styling is the host's job — the classes are the protocol. The Obsidian plugin's `styles.css` is a complete reference implementation.

---

## Level 2: Headless runtime

Use `DraggerRuntime` when your editor is not CM6, or you want full control of the pipeline.

```ts
import { DraggerRuntime } from 'md-dragger/runtime';

const runtime = new DraggerRuntime({
    input: myInputSource,      // pointer press/move/release/cancel/escape
    document: { getDoc: () => myDoc },
    locate: {
        sourceLineFromInput: (input) => resolveSourceLine(input),
        resolveDropPosition: (point, ctx) => resolveDropPosition(point, ctx.selection),
    },
    commit: { apply: (edits) => applyEdits(edits) },
    config: { tabSize: 4, listIndentUnit: 4 },
    onChange: (result) => { /* pipeline transitions */ },
});

runtime.mount();
// ...
runtime.destroy();
```

- `input` implements the `InputSource` contract (see [api-reference.md](api-reference.md#inputsource)).
- `document.getDoc()` returns the `Doc` (a lightweight line-indexed view of the markdown text).
- `locate` maps pointer input to source lines and pointer positions to structural drop positions.
- `commit.apply(edits)` receives `DocEdit[]` — the minimal edits to perform the move. Apply them to the document and re-query the runtime's doc.
- `config` can be a function for live re-reads (e.g. `tabSize` from the editor state).

The adapter is just a reference wiring of these hosts against CodeMirror 6 — read `src/adapter/codemirror/` to see each host implemented in practice.
