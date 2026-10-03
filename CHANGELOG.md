# Changelog

All notable changes to md-dragger are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow [Semantic Versioning](https://semver.org/).

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
