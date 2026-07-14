# Domain 现有结构（As-Is）

Status: **描述现状 only**  
Date: 2026-07-14  
Scope: `src/domain/**` 当前代码里真实存在的类型与主数据流。  
不含目标架构、不含改名建议（见 `domain-cleanup-migration.md`）。

---

## 0. 名称澄清

| 名字 | 是否存在 |
|---|---|
| **`BlockRef`** | **不存在** |
| **`Block`** | **不存在**（目标名，见 `domain-cleanup-migration.md`） |
| **`BlockInfo`** | **存在** — 当前“块”的唯一类型（含 startLine/endLine/from/to/indentLevel/content） |
| **`BlockType`** | **存在** — 块种类枚举 |
| **`BlockSelection`** | **存在** — `anchorBlock` + `focusBlock` + `ranges`（不是 `blocks[]`） |

口语里的“块” = 代码里的 **`BlockInfo`**。  
目标形态见 `domain-cleanup-migration.md` §1（**尚未实现**）：

- `Block = { type, lines }`
- `BlockSelection = { blocks }`
- 落点只有 **`DropPosition`**（`seam | inside(parent)`）— **无 `DropTarget` / `DropGuide`**
- 结构 accept/coerce → 投影编译成 `DocEdit { doc, changes }`（**无 selectionAfter，待以后设计**）
- 无 primary/anchor、无 listIntent 包

---

## 1. 分层与目录（现状）

```text
src/domain/
  index.ts              # 对外 barrel（allow-list，不是 export *）
  perf.ts               # 可选 perf hooks 入口

  block/                # 块类型、检测、guards、类型转换
  command/              # BlockCommand / DropTarget / move|delete 工厂
  markdown/             # Doc、行解析、line-map、drop-locate、list-target、line-range
  selection/            # 选区与 range 运算
  move/                 # planMove / checkDrop
  rules/                # 容器/插入/self-drop 规则
  mutation/             # 插入文本、list indent、delete/insert 字符定位
  transaction/          # moveTx / delete / renumber / command 计划
```

上层依赖关系（现状事实）：

```text
adapter ──► domain（含深路径）
runtime ──► domain（含深路径：mutation / rules / move / transaction…）
pipeline ──► domain（主要是 selection / command 类型）
domain  ──╳── pipeline / runtime / adapter
```

`domain/index.ts` 注释写明：rules / mutation / 部分 transaction / 低层 parse **故意不进 barrel**；但 runtime 会直接 `import '../domain/mutation/...'` 等。

---

## 2. 核心类型一览

### 2.1 文档

**文件:** `markdown/document-types.ts`

```ts
MarkerType = 'ordered' | 'unordered' | 'task'

ListContextValue = { indentWidth, indentRaw, markerType }
ListContext = ListContextValue | null

ParsedListLine = { isListItem, indentRaw, indentWidth, marker, markerType, content }
ParsedLine = {
  text, quotePrefix, quoteDepth, rest,
  isListItem, indentRaw, indentWidth, marker, markerType, content
}

DocLine = { text, from, to }   // 单行：文本 + 字符 span

Doc = {
  lines: number                // 总行数
  length: number               // 总字符数
  line: (n: number) => DocLine // n 为 1-based
  lineAt: (pos: number) => { number: number }
  sliceString: (from, to) => string
}
```

要点：

- **`Doc.line(n)` 是 1-based**（`n ∈ [1, doc.lines]`）
- **`DocLine` = 恰好一行**，不是块

### 2.2 块

**文件:** `block/block-types.ts`

```ts
enum BlockType {
  Paragraph, Heading, ListItem, CodeBlock, Blockquote,
  Table, MathBlock, Callout, HorizontalRule, Unknown
}

interface BlockInfo {
  type: BlockType
  startLine: number   // 0-based，含
  endLine: number     // 0-based，含
  from: number        // 文档字符起点
  to: number          // 文档字符终点
  indentLevel: number
  content: string     // 块文本缓存
}
```

要点：

- **当前“块”类型名是 `BlockInfo`，没有 `Block` / `BlockRef`**
- **行号是 0-based**；和 `Doc.line` 交互时要 `+ 1`
- 由 `detectBlock(doc, lineNumber, { tabSize })` 等产出（`block-detector.ts`）

### 2.3 选区

**文件:** `selection/block-selection.ts` 等

```ts
// block-selection.ts — drag/move/command 用的选区（0-based ranges）
BlockSelectionRange = { startLine, endLine }          // 0-based
BlockSelection = {
  anchorBlock: BlockInfo
  focusBlock: BlockInfo
  ranges: BlockSelectionRange[]
}
RangeSelectionOperation = 'add' | 'remove'

// block-ranges.ts — multi-select 用的块区间（1-based）
SelectedBlockRange = { startLineNumber, endLineNumber }  // 1-based
BlockSelectionSegment = {
  startLineNumber, endLineNumber,
  startBlockLineNumber, endBlockLineNumber
}

// range-selection.ts
RangeSelectionBoundary = {
  startLineNumber, endLineNumber,     // 1-based
  representativeLineNumber
}
RangeSelectionBoundaryResolver = (lineNumber) => { startLineNumber, endLineNumber }

// block-range-selection.ts — range 手势状态机数据
BlockRangeSelectionState = {
  anchorStartLineNumber, anchorEndLineNumber,
  operation, baseBlocks, activeBlocks, selectionBlocks  // SelectedBlockRange[]
}

// selection-ranges.ts — move capture 用的 0-based 复合 range
CompositeLineRange = { startLine, endLine }  // 0-based
```

要点：

- **同一“选中几行”语义，至少两套坐标：**
  - `BlockSelection.ranges` / `CompositeLineRange` → **0-based** `startLine/endLine`
  - `SelectedBlockRange` / `LineRange` → **1-based** `startLineNumber/endLineNumber`
- 单块：`createSingleBlockSelection(block)` → `ranges` 长度为 1  
- 多块：仍是同一个 `BlockSelection`，`ranges` 多段；move/delete **共用** capture 路径

### 2.4 通用行区间（markdown）

**文件:** `markdown/line-range-types.ts`, `line-range.ts`

```ts
LineRange = { startLineNumber, endLineNumber }  // 1-based

// 运算：normalize / merge / clone / inRanges / covered / subtract
```

与 `SelectedBlockRange` **结构相同**，API 平行存在于 `selection/block-ranges.ts`。

### 2.5 行号 clamp

| 函数 | 文件 | 语义 |
|---|---|---|
| `clampLineNumber(docLines, n)` | `line-number.ts` | 夹到 `[1, docLines]` |
| `clampTargetLineNumber(totalLines, n)` | `line-target-number.ts` | 夹到 `[1, totalLines+1]`（插入缝） |
| `clampTarget`（本地） | `move/move-plan.ts` | 同插入缝 |
| `clampInsertionLineNumber`（本地） | `rules/container-policy.ts` | 同插入缝 |

### 2.6 落点 Drop

**文件:** `command/drop-target.ts`

```ts
ListDropTarget = {
  mode: 'sibling' | 'child' | 'outdent'
  contextLineNumber?: number      // 1-based
  targetIndentWidth?: number
}

DropGuide = {
  bandLine: number                // 画缝用的行框
}

DropTarget = {
  targetDoc: Doc
  targetLineNumber: number        // 1-based，可到 lines+1
  placement: 'before' | 'after' | 'inside'
  listIntent?: ListDropTarget
  guide?: DropGuide               // locate 填；move 路径可省
}
```

相关：

- `markdown/list-target.ts` 另有 **`ListIntent`**（与 `ListDropTarget` 几乎同形）
- `markdown/drop-locate.ts`：`locateDropTarget(input) → DropLocateResult`  
  （`targetLineNumber` + `placement: 'before'` + `listIntent?` + `guide`）

### 2.7 命令

**文件:** `command/block-command.ts` 等

```ts
BlockCommand =
  | { type: 'move'; selection: BlockSelection; target: DropTarget }
  | { type: 'delete'; selection: BlockSelection }
  | { type: 'convert'; selection: BlockSelection; to: BlockType }
  | { type: 'indent'; selection: BlockSelection; direction: 'in' | 'out' }

MoveBlockCommand = Extract<BlockCommand, { type: 'move' }>
DeleteBlockCommand = Extract<BlockCommand, { type: 'delete' }>

createMoveCommand(selection, target)
createDeleteCommand(selection)
```

现状：`planBlockCommandTransaction` **只实现 delete**；move 走 `planMove` + `moveTx`，不经统一 command planner。convert / indent 有类型、无完整 plan 实现。

### 2.8 Move 计划

**文件:** `move/move-plan.ts`

```ts
MoveDeps = {
  tabSize: number
  slotAt: (doc, sourceBlock, targetLineNumber, opts) => {
    slotContext: InsertionSlotContext
    decision: { allowDrop, rejectReason? }
  }
  parseLine: (line: string) => ParsedLine
  listCtx: (doc, lineNumber) => ListContext
  insertText: (doc, sourceBlock, targetLineNumber, sourceContent, listIntent?) => string
}

DropInput = {
  sourceDoc: Doc
  selection: BlockSelection
  target: DropTarget
  deps: MoveDeps
  captured?: CapturedMoveSource
}

DropOk = {
  target: DropTarget
  targetLineNumber: number
  slot: InsertionSlotContext
  captured: CapturedMoveSource
  allowIndent: boolean
  lineMap: LineMap
}

MovePlan = {
  command: MoveBlockCommand
  target: DropTarget
  targetLineNumber: number
  slot: InsertionSlotContext
  captured: CapturedMoveSource
  allowIndent: boolean
  deps: MoveDeps                  // 计划里带着函数
}

// checkDrop(input) → DropCheck
// planMove(input)  → MoveResult  (= ok MovePlan | reject)
```

Reject 相关类型（平行多份）：

- `DropRejectReason` / `MoveRejectReason`（move-plan）
- `SelfDropRejectReason`（self-drop）
- `InsertionRuleRejectReason`（insertion-rules）
- `CommandRejectReason`（command-reject）

### 2.9 捕获与事务

**文件:** `transaction/move-blocks.ts`, `block-transaction.ts`, …

```ts
// block-transaction.ts
TextChange = { from, to, insert: string }
DocEdit = {
  doc: Doc
  changes: TextChange[]
  selectionAfter?: BlockSelection | null
}

// move-blocks.ts
MoveSourceSegment = {
  startLineNumber, endLineNumber,   // 1-based
  from, to,
  deleteFrom, deleteTo
}
MoveSourcePayload = {
  content: string
  ranges: CompositeLineRange[]      // 0-based
  segments: MoveSourceSegment[]
}
CapturedMoveSource = {
  block: BlockInfo
  payload: MoveSourcePayload
}

captureMoveSource(doc, selection) → CapturedMoveSource | null
moveTx({ sourceDoc, plan }) → DocEdit[] | CommandReject
planSourceDeletion(payload) → TextChange[]
```

另有：

- `transaction/delete-blocks.ts` — `planDeleteBlocksTransaction`
- `transaction/block-command-transaction.ts` — 目前只路由 delete
- `transaction/list-renumber.ts` — 有序列表重编号 changes
- `transaction/command-reject.ts` — `CommandReject = { type: 'reject', reason }`

**注意：** `mutation/document-change.ts` 里还有**另一份** `TextChange`（`insert?` 可选），与 transaction 的 `TextChange` 并存。  
`block-type-conversion.ts` 的 `BlockTypeConversionChange` 也是 `{ from, to, insert }` 形。

### 2.10 Line map / parse / mutation / rules（支撑件）

| 模块 | 主要出口 | 作用 |
|---|---|---|
| `markdown/line-parser.ts` | `parseListLine`, `parseLineWithQuote`, … | 单行 MD 结构解析 |
| `markdown/line-parsing-service.ts` | `createLineParsingContext(tabSize)` | 绑定 tabSize 的 parse/indent 包 |
| `markdown/indent-calculator.ts` | indent 宽度/字符串、tabSize | 缩进计算 |
| `markdown/line-map.ts` | `LineMap`, `LineMeta`, `getLineMap`, … | 整篇行元数据缓存 |
| `markdown/fence-scanner.ts` | code/math fence range | 围栏块范围 |
| `block/block-guards.ts` | `isListItemLine`, `isCodeFenceLine`, … | 行分类 helper |
| `block/block-detector.ts` | `detectBlock`, `detectBlockType`, … | 块检测（内含另一套 list 解析逻辑） |
| `block/block-type-conversion.ts` | `planBlockTypeConversionChanges` | 块类型转换 → changes |
| `rules/insertion-rules.ts` | `InsertionSlotContext`, `resolveInsertionRule` | 类型×槽位是否允许 drop |
| `rules/container-policy.ts` | `resolveSlotContextAtInsertion`, … | 插入点槽位分类 |
| `rules/container-policy-service.ts` | `resolveDropRuleAtInsertion` | 上者的默认 detect 包装 |
| `rules/self-drop.ts` | `selfDrop` | 落在自身范围内是否允许（含原地 indent） |
| `mutation/list-mutation.ts` | `adjustListToTargetContext`, `computeListIndentPlan`, … | 按目标 list 改源文本 indent |
| `mutation/text-mutation-policy.ts` | `buildInsertTextForDrop` | runtime 注入用的 insertText 胶水 |
| `mutation/document-change.ts` | `resolveInsertionChange`, `resolveDeleteRange` | 字符级插入/删除定位 |

---

## 3. 主数据流（现状）

### 3.1 检测 → 选区

```text
Doc + 行号
  → detectBlock → BlockInfo          (0-based 行)
  → createSingleBlockSelection
  → BlockSelection { anchorBlock, ranges: [一段] }
```

多选手势额外走：

```text
RangeSelectionBoundary + SelectedBlockRange[]
  → create/updateBlockRangeSelectionState
  → selectionBlocks: SelectedBlockRange[]   (1-based)
  →（runtime）再转成 BlockSelection 去拖
```

### 3.2 落点

```text
指针几何（adapter 量）
  → locateDropTarget({ doc, selection, hitLine, belowMid, pastMarker, markerOffset, tabSize, indentUnit })
  → { targetLineNumber, placement: 'before', listIntent?, guide }
  → 包成 DropTarget { targetDoc, targetLineNumber, placement, listIntent?, guide? }
```

### 3.3 计划 → 事务 → 提交

```text
DropInput { sourceDoc, selection, target, deps }
  → checkDrop / planMove
       · captureMoveSource(selection)     // 若未预捕获
       · deps.slotAt → 容器规则
       · 同文档 selfDrop
  → MovePlan
  → moveTx({ sourceDoc, plan })
       · deps.insertText(...)             // 通常是 buildInsertTextForDrop
       · resolveInsertionChange / deletes
  → DocEdit[] | CommandReject
  → adapter applyCommit → host dispatch({ changes })
```

删除：

```text
BlockSelection
  → planDeleteBlocksTransaction / planDeleteCommandTransaction
  → DocEdit | CommandReject
```

---

## 4. 行号坐标系（现状事实表）

| 类型 / API | 字段 | 基 |
|---|---|---|
| `Doc.line(n)` | 参数 `n` | **1** |
| `BlockInfo` | `startLine`, `endLine` | **0** |
| `BlockSelectionRange` | `startLine`, `endLine` | **0** |
| `CompositeLineRange` | `startLine`, `endLine` | **0** |
| `LineRange` | `startLineNumber`, `endLineNumber` | **1** |
| `SelectedBlockRange` | `startLineNumber`, `endLineNumber` | **1** |
| `DropTarget.targetLineNumber` | — | **1**（可至 `lines+1`） |
| `MoveSourceSegment` 行字段 | `startLineNumber`… | **1** |
| `ListDropTarget.contextLineNumber` | — | **1** |

典型桥接：`doc.line(range.startLine + 1)`、`block.startLine + 1`、`normalizeCompositeRanges` 内部 0↔1。

---

## 5. `domain/index.ts` 当前导出（公开面）

导出（摘要）：

- **block:** `BlockType`, `BlockInfo`, `detectBlock*`, conversion, guards  
- **command:** `BlockCommand`, `DropTarget`, `ListDropTarget`, `DropGuide`, move/delete factories  
- **selection:** `BlockSelection*` 全套、`SelectedBlockRange`、range selection、`CompositeLineRange`  
- **move:** `planMove`, `checkDrop`, `MovePlan`, `MoveDeps`, reject reasons…  
- **transaction:** `TextChange`, `DocEdit`, `moveTx`, capture 相关, `CommandReject`, delete command plan  
- **markdown:** `Doc`/`DocLine`/`ParsedLine`…, line-map, list-target, drop-locate, line-range ops, clamps, fence  

**未进 barrel、但 runtime 深链使用的例子：**

- `mutation/list-mutation`（`getListContextNearLine`）
- `mutation/text-mutation-policy`（`buildInsertTextForDrop`）
- `rules/container-policy-service`（`resolveDropRuleAtInsertion`）

---

## 6. 操作对象（用现有类型说）

| 问题 | 现有答案 |
|---|---|
| 用户在操作什么？ | **`BlockInfo`**，一次手势装在 **`BlockSelection`**（`ranges` 可 1 段或多段） |
| 放到哪里？ | **`DropTarget`**（`targetLineNumber` = 行缝，1-based） |
| 最后写出什么？ | **`DocEdit.changes: TextChange[]`**（字符 `from/to/insert`） |
| 物理一行？ | **`DocLine`**（只读工具，不是操作对象） |
| 行号区间？ | 多套并存：`LineRange` / `SelectedBlockRange` / `BlockSelectionRange` / `CompositeLineRange` |

没有名为 `Block` 或 `BlockRef` 的类型；不要在读现状时把迁移文档里的名字当成代码。

---

## 7. 相关文件索引（类型定义入口）

| 主题 | 路径 |
|---|---|
| BlockInfo / BlockType | `src/domain/block/block-types.ts` |
| detect | `src/domain/block/block-detector.ts` |
| Doc / DocLine / ParsedLine | `src/domain/markdown/document-types.ts` |
| DropTarget | `src/domain/command/drop-target.ts` |
| BlockSelection | `src/domain/selection/block-selection.ts` |
| SelectedBlockRange | `src/domain/selection/block-ranges.ts` |
| CompositeLineRange | `src/domain/selection/selection-ranges.ts` |
| LineRange | `src/domain/markdown/line-range-types.ts` |
| planMove | `src/domain/move/move-plan.ts` |
| moveTx / capture | `src/domain/transaction/move-blocks.ts` |
| DocEdit / TextChange | `src/domain/transaction/block-transaction.ts` |
| barrel | `src/domain/index.ts` |

---

## 8. 与迁移文档的关系

| 文档 | 内容 |
|---|---|
| **本文** `domain-current-structure.md` | 只描述 **现在代码里有什么** |
| `domain-cleanup-migration.md` | 目标结构、1-based 决策、改名/合并计划（**未实现**） |

读“现有系统”以本文为准；`BlockRef` 仅属迁移讨论，**不是现有类型**。
