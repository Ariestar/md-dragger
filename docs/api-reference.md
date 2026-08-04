# API reference

Entry points (all ESM + CJS, typed):

| Import | Contents |
| --- | --- |
| `md-dragger` | Re-exports `domain` + `runtime` |
| `md-dragger/domain` | Pure markdown model and move planning |
| `md-dragger/runtime` | Headless `DraggerRuntime` + host contracts |
| `md-dragger/runtime/modules` | Reusable runtime modules (`autoScroll`, …) |
| `md-dragger/adapter/codemirror` | CM6 wiring + decoration builders |

---

## domain

Pure functions and types — no I/O, no DOM.

| Export | Description |
| --- | --- |
| `detectBlock(doc, lineNumber, { tabSize })` | Block containing a line (`{ type, lines: { startLine, endLine } }` or `null`). Handles headings, lists (with subtree), tables, callouts, blockquotes, fences, math, hr. |
| `parseLine(text, tabSize)` | Structural line parse: quote depth, indent, marker (heading/list/table-row/fence/callout/hr), body. |
| `planMove(input)` | Compute a `MovePlan` for moving a `BlockSelection` to a `DropPosition` (respects container rules, indent, renumbering). |
| `moveTx(targetDoc, geometry, parse?)` | Build the minimal `DocEdit[]` for a move (single doc → single edit/transaction). |
| `locateDropPosition({ doc, selection, hitLine, belowMid, … })` | Structural drop position for a target line — where a block may legally land. |
| `selectOne(block)`, `selectBlocks(…)`, `addBlocks/removeBlocks/hasBlock`, `selectionLineRanges` | Selection helpers. |
| `planDelete`, `planConvert` | Block deletion and block-type conversion plans. |
| `isLineNumberInRanges`, `formatIndent`, `isListLine`, `listMarkerType`, … | Utilities. |
| `Doc`, `DocLine`, `Block`, `BlockType`, `DropPosition`, `DocEdit`, `TextChange`, `LineRange`, `ParsedLine`, `Reject` | Types. |

## runtime

### RuntimeOptions

```ts
type RuntimeOptions = {
    input: InputSource;
    document: DocumentHost;          // { getDoc(): Doc }
    locate: LocateHost;              // sourceLineFromInput / resolveDropPosition / lineFromPoint?
    commit: CommitHost;              // { apply?(edits: DocEdit[]): void }
    config: Config;                  // { tabSize, listIndentUnit } or () => …
    scheduler?: SchedulerHost;       // setTimer/clearTimer (defaults to setTimeout)
    ux?: UxFactory | DefaultUxConfig;
    onChange?: (result: PipelineResult) => void;
};
```

### InputSource

```ts
type InputSource = {
    onPress(handler: (input: PressInput) => void): Disposable;
    onMove(handler: (input: MoveInput) => void): Disposable;
    onRelease(handler: (input: ReleaseInput) => void): Disposable;
    onCancel?(handler: (input: CancelInput) => void): Disposable;
    onEscape?(handler: () => boolean): Disposable;
};
```

`PressInput`/`MoveInput`/`ReleaseInput` carry `{ point, pointer, modifiers?, native?, claim?, capture?, releaseCapture? }`. `claim()` means *this event is ours — prevent default and stop propagation*; hosts should only call it when a drag actually starts, so text selection and clicks keep working.

### DraggerRuntime

```ts
const runtime = new DraggerRuntime(options);
runtime.mount();      // subscribe input, start pipeline
runtime.destroy();    // teardown

// Controller surface (used by custom UX / hosts):
runtime.isGestureActive();
runtime.createSessionId();
runtime.beginHold(sessionId, selection, pointerType);
runtime.markHoldReady(sessionId, pointerType);
runtime.beginDrag(sessionId, point, pointer, pointerType);
runtime.moveDrag(sessionId, point, pointer, pointerType);
runtime.commitDrop(sessionId, point, pointer, pointerType);
runtime.setSelection(selection);
runtime.clearSelection();
runtime.cancel(reason?, pointerType?);
runtime.clearSelectionOrCancel(reason?): boolean;
```

### Gesture config

```ts
type GestureConfig = {
    dragArmMs: number;                 // default 0 — hold before a press becomes a drag
    multiSelectMs: number;             // default 500 — hold to enter range select
    dragStartMoveThresholdPx: number;  // default 4 — move before a drag starts
    dragCancelMoveThresholdPx: number; // default 12 — move before a hold cancels
    multiSelectEnabled: boolean;       // default false
};
```

## adapter/codemirror

### mdDragger(options): Extension[]

The all-in-one composition: editor attributes + gutter + runtime + commit routing.

### MdDraggerCodeMirrorOptions

```ts
type MdDraggerCodeMirrorOptions = {
    // Required: tabSize + listIndentUnit. No silent defaults.
    config: Config;

    // Required: rendered pixel width of one list nesting level.
    listIndentWidthPx: number | ((view: EditorView) => number);

    handle?: {
        render?: () => HTMLElement;          // handle DOM; default ⋮⋮ button
        side?: 'before' | 'after';           // gutter side (default 'before')
    };

    locate?: LocateOptions | ((view: EditorView) => LocateOptions);
    //   sourceLineFromInput?, resolveDropPosition?, lineFromPoint?

    onChange?: (result: PipelineResult) => void;

    ux?: DefaultUxConfig;                    // gesture knobs + modules

    // Views where the dragger must stay dormant (no handles, no drags).
    // Re-checked per render and per press because nested editors are
    // mounted detached and only become identifiable once attached.
    enabled?: (view: EditorView) => boolean;
};
```

### Building blocks

Compose them yourself instead of `mdDragger()` when you need a custom mix:

| Export | Description |
| --- | --- |
| `dragHandleGutter(options)` | The gutter extension (per-block `BlockHandleMarker`s). |
| `dragRuntime(options)` | The runtime `ViewPlugin` (input wiring, commit, `dragTransitionEffect` broadcasts). |
| `pointerInput(view)` | CM6 `InputSource` implementation (pointer + keyboard-cancel). |
| `scrollPort(fn)` | Scroll-port module helper for `ux.modules` (used by `autoScroll`). |
| `applyCommit(edits)` | Dispatch `DocEdit[]` as transactions on the owning views. |
| `lineAtPoint(view, point)` / `lineAtScreenPoint(point)` / `sourceLineFromInput(view, input)` / `resolveDropPosition(…)` | Locate helpers. |
| `seamOffset(view, position, options)` / `dropSeam(view, position, options)` / `lineBand(…)` | Geometry for painting the drop seam. |
| `dropSeamDecoration(outputs, state)` / `sourceHighlightDecoration(outputs, state)` / `sourceListLevel(…)` | Decoration builders for the drop seam and drag source. |
| `dragTransitionEffect` | `StateEffect` carrying each pipeline output batch; visual plugins read it off `update.transactions`. |
| `resolveConfig`, `resolveLocateOptions`, `resolveListIndentUnit`, `resolveListIndentWidthPx`, `resolveTabSize`, `isDraggerEnabled` | Config resolvers. |

### Render protocol (host-owned CSS)

The adapter emits protocol classes; hosts style them:

- `.md-dragger-gutter` / `.md-dragger-handle[data-block-start]` — handle gutter and markers.
- `.md-dragger-drag-source` — line decoration on the dragged block rows (carries `--d-source-level` per row).
- `.md-dragger-drop-seam` / `.md-dragger-drop-seam-top` / `.md-dragger-drop-seam-below` / `.is-invalid` — the drop indicator line.
- View-level CSS variables hosts fill from geometry: seam left/width (`--d-seam-left`, `--d-seam-width` in the Obsidian host), rendered list indent step (`--d-list-indent-step`).

The Obsidian plugin's `styles.css` is the reference implementation of the whole protocol.
