# Architecture

md-dragger is layered so the markdown intelligence is pure and reusable, and each host only does the platform-specific work it must.

```
┌──────────────────────────────────────────────────────────┐
│ Host                                                      │
│  • owns the editor instance                              │
│  • renders handles / drop seam / source highlight        │
│  • provides CSS for the protocol classes                 │
│  • decides which views are real documents (enabled)      │
└──────────────────────────┬───────────────────────────────┘
                           │ mdDragger() / DraggerRuntime
┌──────────────────────────┴───────────────────────────────┐
│ adapter/codemirror                                        │
│  • CM6 gutter + handle markers                           │
│  • pointer input (PressInput/MoveInput/…)                │
│  • hit-testing and multi-doc commit routing              │
│  • paint decorations (drag source, drop seam)            │
├──────────────────────────────────────────────────────────┤
│ runtime                                                   │
│  • headless gesture state machine                        │
│  • drag pipeline (press → hold → drag → drop → commit)   │
│  • multi-select, cancel reasons, UX modules              │
├──────────────────────────────────────────────────────────┤
│ domain                                                    │
│  • markdown block detection (heading/list/table/…)       │
│  • structural parse (quotes, indent, markers)            │
│  • move plans, container rules, list renumbering         │
│  • minimal document edits (DocEdit[])                    │
└──────────────────────────────────────────────────────────┘
```

## Layering rules

- **domain never imports runtime or adapter.** It is pure text → plans/edits.
- **runtime never imports adapter.** It talks only to the host contracts (`InputSource`, `DocumentHost`, `LocateHost`, `CommitHost`).
- **adapter is a reference wiring** of the runtime for CodeMirror 6. Hosts may reuse its building blocks or re-wire the runtime themselves.
- **Hosts never re-derive markdown structure.** They consume `detectBlock`/decoration builders; their stylesheet styles the protocol classes.

## Host responsibilities (checklist)

| Concern | Owner | Notes |
| --- | --- | --- |
| Block detection, move plan, edit computation | domain | Nothing to do — call the API. |
| Gesture state machine | runtime | Nothing to do — `mount()`/`destroy()`. |
| Editor integration (CM6 or other) | host or adapter | Adapter for CM6; custom hosts implement the four contracts. |
| Handle / seam / highlight rendering | host | Adapter builds decorations; host styles them. |
| Pointer→source-line mapping overrides | host | Optional `locate` overrides (e.g. Obsidian mobile "row as handle"). |
| Which views are draggable | host | `enabled` predicate; see below. |
| Theme/geometry values | host | `listIndentWidthPx`, tab size, seam offset CSS variables. |

## The `enabled` view filter

Hosts that create **nested CM6 views that are not documents** must exclude them. Obsidian's Live Preview is the canonical case: clicking a table cell opens a transient CM6 editor inside the rendered table widget, which inherits the plugin's registered editor extensions.

```ts
enabled: (view) => view.dom.closest('.cm-table-widget') === null,
```

Two properties matter:

1. **Re-checked per render and per press.** Such nested editors are constructed *detached* and attached later; the predicate only becomes true once the editor's DOM is inside the host widget. The adapter re-evaluates `enabled` on every gutter render (handle visibility) and on every pointer press (drag initiation), never caching the answer.
2. **Keep it cheap and DOM-based.** It runs on the hot path.

When `enabled` is false the adapter renders no handles and the runtime ignores presses entirely — no gesture interception, no drag effects, no live-view registration side effects beyond the transient mount.

## Data flow of a drag

```
pointer press → InputSource.onPress → runtime (press session)
pointer move  → onMove → hold/drag threshold → drag begins
                → drag_source_changed output (host paints source highlight)
pointer move  → drag_over → locate.resolveDropPosition → seam painted
pointer up    → commitDrop → domain move plan → DocEdit[] → commit.apply
                → dropped output → host clears paint, refreshes doc
Escape / cancel → cancel output with reason (host can distinguish
                press_cancelled for menus, keyboard_escape, …)
```

Each pipeline transition is broadcast as `dragTransitionEffect` (adapter), which visual plugins read off `update.transactions` — paint stays in the same render pipeline as the text, with no global event bus.
