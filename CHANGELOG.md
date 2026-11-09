# Changelog

All notable changes to md-dragger are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [Semantic Versioning](https://semver.org/).

## [2.3.0] — 2026-11-10

### Added

- Multi-line `%%` comments are atomic fenced blocks (`BlockType.Comment`), including conversion to and from comments (#124).
- Dragging a paragraph, heading, or blockquote into a list adapts it to that list's marker. A heading title that looks like a list item is kept. A selection that also contains a code, math, or comment block is left unchanged (#125).
- Alt during a drag copies instead of moving, and later modifier changes update the active drag (#114).
- `renderHandle` receives the block and its opening-line marker (#113).

### Fixed

- Ordered-list renumbering only touches the runs a move changes (#112).
- An in-place indent change updates every selected segment once (#111) and does not duplicate ordered-list numbers (#110).
- Moving a list item keeps its fence, table, heading, rule, and math children (#109).
- An unclosed `%%` or `$$` no longer hides a later code fence.
- Tearing down a CodeMirror view does not dispatch into that view while the update is still running (#140).

## [2.2.1] — 2026-10-11

### Added

- `MdDraggerCodeMirrorOptions.contentLeft?: ContentLeft` — optional physical x-axis origin of the content column for editors with custom line margins (e.g. centered line width). Defaults to `view.contentDOM.getBoundingClientRect().left`.

### Fixed

- Preserve independent block detection and drag handles for indented continuation lines inside list items (#106).
- Anchor list drop indentation step calculation to configurable `contentLeft` instead of full-width `contentDOM` (#107).

## [2.2.0] — 2026-10-03

### Added

- Unified block template conversion through `BlockTemplate` and `planConvert`, including content variables and per-line prefixes.
- `md-dragger/adapter/monaco`: native Monaco pointer input, model snapshots, undoable commits, locating, overlays, and disjoint selection highlights. Monaco is an optional peer dependency.
- Shared `snapDrop`, `SnapDropInput`, and `listLevel` exports in `md-dragger/domain` for editor adapters.

### Fixed

- Nested list drops across editor windows preserve the source document identity and use the destination content edge for indentation.
- List indentation rejects non-finite or non-positive units explicitly.

### Deprecated

- CodeMirror's `sourceListLevel` remains a direct alias of `listLevel` for compatibility. Import `listLevel` from `md-dragger/domain`; the alias is scheduled for removal in the next major release.

## [2.0.1] — 2026-08-05

### Added

- `MdDraggerCodeMirrorOptions.enabled?: (view) => boolean` — hosts can mark views where the dragger must stay dormant (no handles, no drags). The predicate is re-checked **per render and per press**, because such editors (e.g. Obsidian's nested table-cell editor) are mounted detached and only become identifiable once attached.
- New `isDraggerEnabled` config resolver exported from `md-dragger/adapter/codemirror`.

### Fixed

- Views excluded by `enabled` no longer paint handles (`dragHandleGutter`) and never initiate drags (`dragRuntime` skips mounting when disabled and re-checks the predicate on every press).

## [2.0.0] — 2026-07

### Changed

- Headless drag pipeline: `DraggerRuntime` with `InputSource`/`DocumentHost`/`LocateHost`/`CommitHost` contracts; domain API slimmed to host-facing types and plan/edit/parse APIs.
- CM6 adapter (`md-dragger/adapter/codemirror`) with `mdDragger()`, `dragHandleGutter`, `dragRuntime`, and paint/decorations helpers.
- List renumbering unified with the snap/drop pipeline; single `DocEdit` per move (single undo).
