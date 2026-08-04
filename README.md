# md-dragger

**Platform-agnostic markdown block drag-and-drop engine.**

md-dragger is a headless core for block-level drag and drop in markdown editors: it detects markdown blocks (headings, lists, tables, callouts, code, math, …), runs the drag gesture, computes the move, and produces a minimal document edit. It does **not** import Obsidian, CodeMirror, DOM events, or any editor API — hosts wire it into their editor of choice.

[![npm](https://img.shields.io/npm/v/md-dragger?logo=npm&label=npm)](https://www.npmjs.com/package/md-dragger) ![License](https://img.shields.io/github/license/Ariestar/md-dragger) [![CI](https://github.com/Ariestar/md-dragger/actions/workflows/ci.yml/badge.svg)](https://github.com/Ariestar/md-dragger/actions/workflows/ci.yml)

- **Headless** — no UI, no editor, no platform dependency in the core.
- **Markdown-aware** — block detection, nesting, container rules, list renumbering, and table/math/fence integrity are all computed on the document model.
- **Two integration levels** — drop in the CodeMirror 6 adapter, or drive the runtime with your own input/commit/locate hosts.
- **Small & typed** — strict TypeScript, tree-shakeable entry points.

Reference hosts:

- [obsidian-dragger](https://github.com/Ariestar/obsidian-dragger) — Obsidian plugin built on the CM6 adapter.
- `site/` — an in-repo [Astro playground](site) that demonstrates the adapter on [ink-mde](https://github.com/inkandswitch/ink-mde): run `pnpm --dir site dev`.

## Install

```bash
npm install md-dragger
# peer dependencies for the CM6 adapter
npm install @codemirror/state @codemirror/view
```

### Entry points

| Import | Contents |
| --- | --- |
| `md-dragger` | Domain + runtime aggregates |
| `md-dragger/domain` | Pure markdown model: `detectBlock`, `parseLine`, `planMove`, `moveTx`, `locateDropPosition`, selection helpers |
| `md-dragger/runtime` | Headless `DraggerRuntime`, input/locate/commit host types |
| `md-dragger/runtime/modules` | Reusable runtime modules (e.g. `autoScroll`) |
| `md-dragger/adapter/codemirror` | CM6 wiring: `mdDragger()`, `dragHandleGutter`, `dragRuntime`, paint/decorations helpers |

## Quick start (CodeMirror 6)

```ts
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { mdDragger } from 'md-dragger/adapter/codemirror';

const view = new EditorView({
    parent: document.body,
    state: EditorState.create({
        doc: '# Title\n\n- item one\n- item two',
        extensions: [
            mdDragger({
                // Required: structural config. tabSize is re-read live from the
                // editor state; listIndentUnit is the nesting step in columns.
                config: { tabSize: 4, listIndentUnit: 4 },
                // Required: rendered pixel width of one list nesting level
                // (x-axis drag step). Measure it from your theme.
                listIndentWidthPx: 36,
            }),
        ],
    }),
});
```

The adapter paints a `⋮⋮` handle per block in a gutter and wires pointer input, drop hit-testing, cross-pane commits, and the drag pipeline. Hosts provide the CSS (the protocol classes are documented in [docs/api-reference.md](docs/api-reference.md); see the Obsidian plugin's `styles.css` for a reference implementation).

For non-CM6 editors, drive `DraggerRuntime` directly — see [docs/getting-started.md](docs/getting-started.md).

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│ Host — owns the editor, renders handles/seam, styles     │
│   (obsidian-dragger, the site playground, …)             │
└──────────────────────────┬───────────────────────────────┘
                           │ mdDragger() / DraggerRuntime
┌──────────────────────────┴───────────────────────────────┐
│ adapter/codemirror — CM6 gutter, pointer input, locate,  │
│   commit routing, paint decorations                      │
├──────────────────────────────────────────────────────────┤
│ runtime — headless gesture state machine & drag pipeline │
├──────────────────────────────────────────────────────────┤
│ domain — pure markdown block model, parsing, move plans  │
└──────────────────────────────────────────────────────────┘
```

- **domain** is pure: text in, plans/edits out. No I/O, no DOM.
- **runtime** is headless: it consumes an `InputSource`, a `DocumentHost`, a `LocateHost`, and a `CommitHost` and drives the gesture/drop pipeline.
- **adapter** connects the runtime to CodeMirror 6 and exposes decoration builders hosts paint from.

See [docs/architecture.md](docs/architecture.md) for the full host responsibility checklist.

## Documentation

- [Getting started](docs/getting-started.md) — detailed integration guide (adapter and headless runtime), including the `enabled` view filter.
- [API reference](docs/api-reference.md) — every public option and export.
- [Architecture](docs/architecture.md) — layering, host contract, and the paint protocol.
- [Changelog](CHANGELOG.md)

## License

[MIT](LICENSE)
