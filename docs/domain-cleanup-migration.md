# Domain Cleanup Migration

Status: **target structure locked, not implemented**  
Date: 2026-07-14  
Goal: domain is a pure calculation layer. `pipeline` / `runtime` / `adapter` depend on it only.

Companion: [`domain-current-structure.md`](./domain-current-structure.md) = as-is code only.

---

## 0. Product stance

**Notion-like block UX** on **Markdown source text**.

| Layer | Truth |
|---|---|
| User mental model | Blocks: select, reorder, nest into containers |
| Persistence | Plain Markdown (`Doc`) — **not** a live block-tree DB |
| Domain job | Detect structure → plan structure move → **compile** to `TextChange[]` |

```text
logical tree (ephemeral)     source string (persistent)
─────────────────────        ─────────────────────────
Block / order / inside   →   lines, markers, >, fences
```

Detect when needed. Never keep a second durable graph.

---

## 1. Canonical structure (the clean model)

### 1.1 Two layers (do not mix)

```text
┌──────────────────────────────────────────────┐
│  STRUCTURE (logic)                            │
│  Block, BlockSelection                        │
│  DropPosition = seam | inside(container)      │
│  accept?  coerce(source → role at position)   │
└──────────────────────┬───────────────────────┘
                       │ compile
┌──────────────────────▼───────────────────────┐
│  PROJECTION (Markdown source)                 │
│  indent width, list marker, quote prefix…     │
│  → TextChange / DocEdit                         │
└──────────────────────────────────────────────┘
```

| Belongs in STRUCTURE | Belongs in PROJECTION |
|---|---|
| block type | `indent` column width |
| order (before/after) | `-` / `1.` / task marker text |
| containment (inside whom) | `>` quote prefix |
| type coerce (paragraph→list item) | fence lines, blank-line joins |

**List is one container kind**, not a second architecture.  
`mode` / `contextLine` are not structure truths; absolute projection data (e.g. indent) is enough to write source.

### 1.2 Core types

```ts
// ── geometry (1-based, inclusive) ──────────────────────────
type LineRange = {
  startLine: number
  endLine: number
}

// ── document (host-agnostic) ───────────────────────────────
type DocLine = { text: string; from: number; to: number }

type Doc = {
  lines: number
  length: number
  line: (n: number) => DocLine   // n ∈ [1, lines]
  lineAt: (pos: number) => { number: number }
  sliceString: (from: number, to: number) => string
}

// ── structure ──────────────────────────────────────────────
type BlockType =
  | 'paragraph' | 'heading' | 'list-item' | 'code-block'
  | 'blockquote' | 'table' | 'math-block' | 'callout'
  | 'hr' | 'unknown'
// (enum or union — one public definition)

/** Detected span. Ephemeral. No char cache, no content, no indentLevel. */
type Block = {
  type: BlockType
  lines: LineRange
}

/** Non-empty, sorted by lines.startLine, non-overlapping. */
type BlockSelection = {
  blocks: Block[]
}

/**
 * Structural drop position.
 * Nesting is position-driven (where you point), not selection-primary-driven.
 */
/**
 * Structural drop position — the only “where” type.
 * No DropTarget wrapper, no DropGuide, no listIntent bag.
 * Paint derives band line from `line`; indent/marker from Doc + parent at compile/paint time.
 */
type DropPosition =
  | {
      kind: 'seam'
      doc: Doc
      /** Insert *before* this 1-based line; doc.lines+1 = end of doc */
      line: number
    }
  | {
      kind: 'inside'
      doc: Doc
      /** Container block that receives children (list item, quote, callout, …) */
      parent: Block
      /** Seam inside parent content, still a 1-based insert-before line */
      line: number
    }

// ── commit ─────────────────────────────────────────────────
type TextChange = { from: number; to: number; insert: string }

type DocEdit = {
  doc: Doc
  changes: TextChange[]
  // selectionAfter: deferred — not in v1 target; UX post-apply selection TBD later
}

type Reject = { type: 'reject'; reason: RejectReason }
type Ok<T> = { type: 'ok'; value: T }
type Result<T> = Ok<T> | Reject
```

No `BlockInfo`, `BlockRef`, `DropTarget`, `DropGuide`, `primaryIndex`, `anchorBlock`, `focusBlock`,  
`ListIntent` / `listIntent`, mandatory `contextLine`, `placement`, dual range types, dual `TextChange`,  
**no `selectionAfter` on `DocEdit` (deferred)**.

### 1.3 Container vs leaf (structure roles)

| Role | Types (examples) | Can be `inside` parent? |
|---|---|---|
| **Leaf** | paragraph, heading, hr, table, code, math | No |
| **Container** | list-item, blockquote, callout | Yes |

```ts
function isContainerType(t: BlockType): boolean {
  return t === 'list-item' || t === 'blockquote' || t === 'callout'
}
```

Extensible later (e.g. toggle) without a new drop model.

### 1.4 Pipeline

```text
Doc
  │ detectBlock(line) → Block
  │
Block[] → BlockSelection { blocks }
  │
pointer + Doc → locate → DropPosition
  │
planMove({ sourceDoc, selection, position, tabSize, indentUnit })
  │   1. capture source text from selection.blocks[].lines
  │   2. accept(position, selection)?     // structure rules
  │   3. coerce(selection → role at position)?  // e.g. para→list-item
  │   4. self-drop / same-doc constraints
  │   → MovePlan (data only)
  │
compile(plan) → DocEdit[]                 // projection → TextChange
  │
host.apply(DocEdit)
```

| Stage | Inputs | Outputs |
|---|---|---|
| detect | `Doc`, line | `Block` |
| select | `Block[]` | `BlockSelection` |
| locate | pointer metrics + `Doc` | `DropPosition` |
| plan | selection + position | `MovePlan` or reject |
| compile | plan + `Doc` | `DocEdit[]` |

### 1.5 Coerce (any block into containers)

Structure plan may **change type** when entering/leaving a container:

| Source | Position | Result role |
|---|---|---|
| paragraph | `seam` in document flow | paragraph |
| paragraph | `inside(list-item)` / list child seam | **list-item** (wrap marker) |
| list-item | top-level `seam` | product choice: keep list or unwrap to paragraph |
| heading | `inside(blockquote)` | quoted heading/paragraph (product) |
| any | `inside(callout)` | per rules table |

Rules table shape (conceptual):

```text
accept(parentRole | 'document', childTypes[], positionKind) → allow | reject
coerce(sourceType, targetRole) → targetType + projection hints
```

Projection for list role:

- sample marker + indent style from **nearest list line at target** (from `Doc`, not from source “primary”)
- absolute child indent from parent list line + `indentUnit`
- if source lines lack markers → prefix markers; if they have them → reindent

**No source primary field.** Multi-select into a list is allowed when rules accept the whole set; one target position applies one projection policy to the moved material.

### 1.6 What locate must produce

Adapter measures only geometry (hit line, below mid, past marker, column offset, …).

Domain `locate` maps that to **structure**:

```text
default → seam { line }
pointer in container body / nest zone → inside { parent, line }
```

For list nest zones, parent is the **target** list-item block under the pointer (detected from `Doc`), not a field on the selection.

Projection numbers (indent width) are computed in **compile** from:

- `position` (parent or seam neighbourhood)
- `LineMap` / parse of target lines
- `indentUnit` / `tabSize` config

They are **not** a parallel public `list: { mode, contextLine, indent }` API unless we need a debug snapshot; even then commit only needs what compile already re-derives.

Optional cache only inside `MovePlan` (never a public drop wrapper):

```ts
// inside MovePlan only, if we want to avoid remeasure
projection?: {
  indentWidth: number
  markerSample?: string
}
```

Locate / plan / pipeline all pass **`DropPosition` only**.  
Preview: adapter computes pixels from `position.line` (+ indent derived from Doc/parent).

### 1.7 Selection model

```ts
BlockSelection = { blocks: Block[] }
```

| Need | How |
|---|---|
| Single block | `{ blocks: [b] }` |
| Multi block | `{ blocks: [b1, b2, …] }` sorted |
| What text moves | union of `blocks[i].lines` |
| Nest allowed? | **position + rules**, not `blocks.length` |
| Which type drives nest UI? | **target parent / hit**, not selection anchor |

Deleted: `anchorBlock`, `focusBlock`, `ranges[]`, `primaryIndex`, `SelectedBlockRange` world.

### 1.8 Line numbers

**1-based everywhere** in domain / pipeline / runtime.  
`Doc.line(n)` is already 1-based. Adapter converts only if host is 0-based (CM line numbers are 1-based — usually no convert).

Exactly two clamps:

```ts
clampLine(docLines, n)        // [1, docLines]
clampInsertLine(docLines, n)  // [1, docLines+1]
```

### 1.9 Derived helpers (optional, not a type zoo)

Prefer inline. If extracted, keep private to domain:

```ts
// not fields on Block
blockCharSpan(doc, block) → { from, to }   // from lines + doc.line

// not a second selection truth
lineRangesOf(sel) → LineRange[]            // map blocks → merge
```

Do **not** export a ceremony API (`selectOne`, `canListNest`, …) unless tests need it.

### 1.10 Folder shape (after types stabilize)

```text
src/domain/
  index.ts                 # sole public export
  core/
    doc.ts                 # Doc, DocLine
    line.ts                # LineRange, clamp*, range algebra
    change.ts              # TextChange, DocEdit, Result
    block.ts               # BlockType, Block, isContainerType
  parse/
    line.ts                # single line classifier
    indent.ts
    fence.ts
  map/
    line-map.ts
  detect/
    block.ts               # detect → Block
  select/
    selection.ts           # BlockSelection
  drop/
    position.ts            # DropPosition only
    locate.ts              # pointer → DropPosition
    rules.ts               # accept / container policy
    coerce.ts              # type role transforms
  plan/
    move.ts
    delete.ts
    convert.ts
  compile/                 # was mutation + transaction
    capture.ts
    project.ts             # structure plan → MD text
    move.ts
    delete.ts
    renumber.ts
  perf.ts
```

---

## 2. Mapping from today → target

| Today | Target |
|---|---|
| `BlockInfo` + from/to/content/indentLevel | `Block = { type, lines }` |
| `BlockSelection` anchor/focus/ranges | `{ blocks: Block[] }` |
| `DropTarget` + `DropGuide` + `listIntent` + `placement` | **`DropPosition` only** (`seam` \| `inside`) |
| `ListDropTarget.mode/contextLine/targetIndentWidth` | structure via `inside`/`seam`; indent/marker in compile/paint from Doc |
| `MoveDeps` fake DI | direct domain calls; plan data only |
| many reject unions | one `RejectReason` / `Result<T>` |
| many range types | one `LineRange` |
| two `TextChange` | one |
| multi parse paths | one `parse/line` |

---

## 3. Public barrel (truth)

Consumers only:

```ts
import { ... } from 'md-dragger/domain'
```

Export roughly:

- `Doc`, `DocLine`, `LineRange`, clamps, range algebra  
- `BlockType`, `Block`, `detectBlock`, …  
- `BlockSelection`  
- `DropPosition`, `locateDropPosition` (rename from locateDropTarget)  
- `planMove`, `planDelete`, `move`/`compile` entry, `DocEdit`, `TextChange`, `Result`  

No deep imports from `runtime` / `pipeline` / `adapter` into `domain/**` internals.

Architecture tests:

1. no deep domain imports from upper layers  
2. domain does not import upper layers  
3. no 0-based span types after migration  
4. single `TextChange`  
5. no `indentLevel` / cached `content` on `Block`

---

## 4. Migration phases

### P0 — Geometry + Block + Selection

1. One `LineRange`, 1-based clamps.  
2. `BlockInfo` → `Block { type, lines }`.  
3. `BlockSelection` → `{ blocks }`.  
4. Delete dual range algebras / composite 0-based bridges.  
5. Capture from `blocks[].lines`.  
6. Green tests.

### P1 — DropPosition + target-driven nest

1. Replace list-intent bag with `DropPosition` (`seam` \| `inside`).  
2. locate emits structure from hit geometry.  
3. plan accept/self-drop against position.  
4. compile projects indent/marker (list still first container).

### P2 — Coerce + multi-container

1. `coerce` for non-list → list-item (and quote later).  
2. Rules table by parent role × child types.  
3. Remove `MoveDeps`; single parse; single change type.

### P3 — Folders + barrel lock

1. Rename packages to structure/compile layout.  
2. Delete service forwarders.  
3. Command surface A or B (not half).  
4. Architecture tests.

---

## 5. Non-goals / deferred

- Durable block graph / CRDT block store  
- Pixel math in domain  
- Keeping `mode` as commit input  
- Selection-side primary/anchor for nest  
- Folder move before P0/P1 types are green  
- **`selectionAfter` / post-apply selection UX** — not designed yet; omit from `DocEdit`. Existing fold-restore can stay host-side later without blocking core model.  

---

## 6. One-liner

> **Structure:** `Block` + `BlockSelection` + `DropPosition(seam|inside)` + accept/coerce.  
> **Projection:** compile to Markdown `TextChange` / `DocEdit { doc, changes }`.  
> **Storage:** only `Doc`. No DropTarget/Guide; no selectionAfter in v1.

---

## 7. Vocabulary cheat sheet

| Word | Means |
|---|---|
| Block | `{ type, lines }` — only block type in target |
| BlockInfo | **legacy name** in current code |
| DropPosition | only where-type (`seam` \| `inside`); **no** DropTarget / DropGuide |
| DropTarget / DropGuide / listIntent | **deleted** in target model (legacy in as-is code) |
| Projection | MD encoding of a structural plan |
| Coerce | change block role when entering a container |
