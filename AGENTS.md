# AI Agent Instructions

This file is the single source of truth for AI coding assistants working on **md-dragger**.

Keep this file limited to durable, cross-session guidance. Current progress and temporary scratch do not belong here.

## Project

- Purpose: Platform-agnostic core engine for markdown block drag-and-drop
- Stack: TypeScript, esbuild (dual CJS/ESM), CodeMirror 6 (peer dependency, adapter only)
- Package manager: pnpm
- Consumers: `obsidian-dragger` (`file:` dependency), `site/` (Astro playground, built with Bun)

## Commands

- Install: `pnpm install`
- Build: `pnpm run build`
- Typecheck: `pnpm run typecheck`
- Lint: `pnpm run lint` (Biome); formatting: `pnpm run format` / `format:check`
- Test: `pnpm test` (Vitest)
- Package checks: `pnpm run lint:pkg` (publint), `pnpm run check:types` (attw)

## Architecture — layer responsibilities

The engine is platform-agnostic. DOM, `window`, and CodeMirror APIs belong to the adapter layer only; domain, pipeline, and runtime stay pure TypeScript.

| Layer | Path | Owns |
|---|---|---|
| domain | `src/domain` | Pure calculation: block detection (`detectBlock`), selection math (`selectOne`, `addBlocks`, `selectionLineRanges`, `isLineNumberInRanges`), move planning (`planMove`), transactions (`moveTx`), markdown parsing. No side effects, no DOM. |
| pipeline | `src/pipeline` | Drag state machine: `hold → ready → dragging → drop/cancel`. Emits outputs that hosts consume for rendering. |
| runtime | `src/runtime` | Gesture UX (`DefaultUx`: press/arm/range-select/toggle), drag session (`DraggerRuntime`), the `InputSource` contract (`dragger-runtime-types`). |
| adapter | `src/adapter/codemirror` | CodeMirror binding only: pointer events → `InputSource`, handle gutter, locate/geometry (`lineBand`, `dropSeam`), commit application. |

Dependency rules:

- `domain` never imports `pipeline`, `runtime`, or `adapter`.
- `runtime` never imports `adapter` — it talks to the `InputSource` interface.
- DOM/`window`/CodeMirror APIs live only in `adapter`.
- `src/domain/index.ts` is the public surface: reusable calculations are exported there so hosts never reimplement them.

## Communication

- Use Simplified Chinese for user-facing explanations, questions, progress updates, and summaries.
- Keep code, identifiers, comments, logs, test names, and commit messages in English.

## Working Agreement

- Stay within the stated scope. Do not add, refactor, or improve unrelated functionality.
- Fix engine logic here; hosts (obsidian-dragger) are for rendering and integration only.
- Do not add dependencies unless the user approves them.
- Create commits only when the user asks.

## Verification

- Run the relevant checks after changes: `typecheck`, `lint`, `test`, `build`; add `lint:pkg` / `check:types` for package-affecting changes.
- Fix failures caused by the current change, then rerun.
- Review the final diff and keep it task-related only.

## Done

- Relevant checks pass, or unrun checks are explained.
- Summary states what changed, key decisions, and remaining risks.
