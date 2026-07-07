# md-dragger 架构

## 分层

- **domain**：纯 markdown/block/drop/move 规则。无状态、无 IO、无平台概念。
- **pipeline**：纯状态机。吃语义事件（`hold_start`/`hold_ready`/`drag_start`/`drag_over`/`drop`/`cancel`…），吐状态和 outputs。无定时器、无阈值、无 session。
- **runtime**：headless 编排层。持有 pipeline、做 drop planning、编排 commit、跑生命周期清理。**不懂 DOM、不懂坐标、不识别手势的物理细节。**
- **adapter**：平台层。DOM/input/hit-test/render/宿主 transaction。

关键分界：pipeline 只认**语义事件**；把裸 pointer 提升成语义事件（long-press 定时、位移阈值、抖动取消、session 管理）是 runtime 上游的**输入阶段**在做，不是 pipeline 的职责，也不是 runtime 核的职责。

## runtime 的固定核

runtime 只有这五件事是不可替换的核：

1. 持有 pipeline
2. drop planning（`plan` + `moveTx`）
3. commit 编排（把 transaction 交还宿主）
4. broadcast（**单条**输出流）
5. 生命周期清理（`destroy` 清定时器、清 session、清 preview）

除此之外的一切（手势识别、ux 接线、preview 渲染）都是**可替换的平台阶段**，runtime 提供默认实现，平台可整套换掉。

## runtime 的边界：五条固定 IO 契约轴

| 轴 | 方向 | 契约 | 说明 |
|---|---|---|---|
| **document** | host→rt (pull) | `getDoc(): DocLikeWithRange` | runtime 主动读文档。只读，不放写。 |
| **locate** | host→rt (pull) | `sourceLineFromInput` / `resolveDropTarget` | runtime 不理解屏幕坐标，只消费 adapter 的 hit-test 结果。 |
| **commit** | rt→host (需回话) | `commit.apply(transaction, ctx)` | drop 落定时把**整个 transaction** 交还宿主。 |
| **broadcast** | rt→host | `onResult(transition)` | 单一事实来源。 |
| **scheduler** | 注入 | `{ setTimer, clearTimer }` | 收拢散落的定时器能力。 |

命名约定：包名 `md-dragger` 本身就是命名空间，类型名去掉 `Dragger` 前缀。结构类型用短名（`DocumentHost`/`LocateHost`/`CommitHost`/`OutputHost`/`InputStage`），少数消费者会直接 import 的顶层类型（`Config`/`RuntimeOptions`）也去前缀，撞名由消费者用 `import { Config as ... }` 自行解决。`ConfigInput` 后缀取消——`Config` 一个名字同时接受对象或 `() => 对象`，内部 resolve。

```ts
type RuntimeOptions = {
  document: DocumentHost;   // pull：读文档
  locate: LocateHost;       // pull：坐标 → 行号/target
  commit: CommitHost;       // 回话：交还 transaction
  output?: OutputHost;      // broadcast：单流
  scheduler?: SchedulerHost;// 注入：定时器
  input?: InputStage;       // 可换输入阶段（见下），默认 batteries-included
  config?: Config | (() => Config);
};
```

### document —— 只读

```ts
{ getDoc(): DocLikeWithRange }
```

读文档和写文档是两种能力，不要把 `applyChanges` 塞进这里。写在 commit 轴。

### locate —— 坐标翻译

```ts
{
  sourceLineFromInput(input): number | null
  resolveDropTarget(point, context): DropTarget | null
}
```

runtime 不自己算坐标，只消费 adapter 的 hit-test。

`selectionLineFromPoint` 删掉——选择路径已统一走 selection，`sourceLineFromInput` 一个入口覆盖全部。"仅 handle 门控"还是"任意行"是 adapter 内部按 input 判断的事，不需要 runtime 多开一个坐标入口。

### commit —— 交还 transaction（不是 output 事件）

```ts
{
  apply(transaction: BlockTransaction, context: DropCommitContext): void
}
```

三个关键设计点：

1. **交还整个 `BlockTransaction`，不是裸 `changes`。** `moveTx` 产出的 transaction 带 `effects`（`restore-fold-state`、`renumber-ordered-list`）。只传 `changes` 会静默丢掉 effects——这是当前实现的真实 bug（apply 路径只调 `applyChanges(transaction.changes)`，effects 落地）。
2. **没有 `mode: 'apply' | 'command'` 开关。** 这是伪二分。"直接改文档"还是"接 history/undo"是宿主在自己的 `apply` 实现里的自由：想直接落就 `dispatch(transaction.changes)`，想接 history 就自己包 transaction。runtime 无条件"交还 transaction"就同时覆盖两种宿主，不需要知道区别。
3. **`commit.apply` 是必填，无回退。** 这消掉了"类型可选、运行时必填"的矛盾——不会再有静默 `TypeError`。不保留对老式 `document.applyChanges` 的回退：`document` 轴只读，写一律走 `commit.apply`。

commit **不是**广播事件：广播是 fire-and-forget，commit 需要宿主拿 transaction 去接自己的落地/undo。所以它是独立的一条轴，不进 `onOutputs` 流。

### broadcast —— 单一事实来源

```ts
output?: {
  onResult?(transition: Transition): void
}
// Transition = { previous: PipelineState; current: PipelineState; outputs: PipelineOutput[] }
```

回调只收一个参数。旧签名 `onOutputs(outputs, result)` 的 `outputs` 参数就是 `result.outputs`，重复传递；收成单参 `onResult(transition)`，且 `PipelineResult`（"一次 transition 的结果"）更名 `Transition`，更贴切。

**PipelineOutput 是唯一事实来源。** runtime 至少完整透传：

```
state_changed  selection_changed  drag_source_changed
drag_over  dropped  cancelled  command_ready  terminal  lifecycle
```

便利回调（`onPreview`/`onSelection`/`onDragSource`/`onLifecycle`）如果保留，**必须是从这条流纯派生的视图**，不能形成第二套语义。当前实现的教训：七个平级回调、其中五个从没被调用——那不是"派生"，是分叉出一份虚假 API 契约。要么让它们真正由 `onOutputs` 驱动，要么删掉。

runtime 自己只额外派生一样东西：

- **DragPreview**：由 `drag_over` 派生，给 UI 画 drop indicator。

### scheduler —— 注入定时器

```ts
{ setTimer(callback, delayMs): token; clearTimer(token): void }
```

比散落的顶层 `setTimer`/`clearTimer` 清楚。`destroy` 必须清掉所有在途 token。

## 输入阶段与 ux/preview 的对称

gesture 识别**不是**独立的边界轴，也**不是** pipeline 的一部分。它是原始平台输入的一个**可替换识别视图**——和 preview（广播流的可替换渲染视图）严格对称：

```
输入侧：平台原始输入 → [输入阶段：gesture + ux 接线，可换] → pipeline 语义事件
输出侧：pipeline → broadcast 流 → [preview 阶段：平台渲染] → 平台
```

- **输入阶段**默认实现 batteries-included：pointer 阈值提升（press→drag）、long-press、抖动取消、selection 手势判定、把 `input` 源接到内部命令式方法上。平台可整套替换（例如改用浏览器原生 HTML5 DnD，让浏览器管阈值，直接喂 `drag_start`/`drag_over`/`drop`），就像 `ux: 'none'`。
- **preview 阶段**：平台拿广播流自己画，runtime 不碰渲染。

runtime 核对外仍暴露命令式方法（默认输入阶段内部要调，宿主也可直接驱动）：

```
handlePress / handleMove / handleRelease / handleCancel
handleSelectionChange / finishSelection
clearSelectionOrCancel / destroy
```

但这些是**默认输入阶段暴露的口子**，不是边界契约的一等公民。`handleSelectionChange` / `finishSelection` 属于默认阶段的选择路径，必须补齐（当前缺失，导致拖拽范围选择经由 runtime 够不到）。

## 一句话总结

runtime 的真实边界 = 五条固定 IO 轴（document/locate/commit/broadcast/scheduler）+ 一个可换的输入阶段（gesture+ux，与输出侧的 preview 对称）。核只做编排，不碰 DOM、不碰坐标、不锁死落地方式。
