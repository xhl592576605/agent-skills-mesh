# Solid Patterns

> Reactive primitives, OpenTUI hooks, and owner-context rules for `src/tui/**`.

This guide replaces the former `hook-guidelines.md`. The TUI is SolidJS +
OpenTUI; there are no class-component lifecycle hooks, only reactive primitives
and OpenTUI-provided hooks.

---

## Current State

Reactive state lives under `src/tui/state/` as small factories
(`createMatrixState`, `createSearchState`, `createDialogStore`). OpenTUI hooks
(`useKeyboard`, `useRenderer`, `useTerminalDimensions`) come from
`@opentui/solid`. SolidJS primitives (`createSignal`, `createStore`,
`createEffect`, `onMount`, `onCleanup`, `createMemo`, `batch`, `Show`, `For`)
come from `solid-js`.

---

## Reactive Primitives

- `createSignal<T>(initial)` — read/write atom. Read by calling the getter
  (`count()`); write with a setter (`setCount(n)` or `setCount(c => c+1)`).
- `createStore<T>(initial)` — fine-grained reactive object/array. Use for
  snapshots and dialog stacks: `setStore("loading", true)` or
  `setStore({ ... })`. The dialog store (`src/tui/context/dialog.tsx`) is a
  `createStore<DialogStackItem[]>`.
- `createEffect(fn)` — runs after render when its tracked dependencies change.
  Used in `DoctorView` to re-run `loadDoctor()` when `snapshot.index` changes,
  and to clamp the cursor when the list is reduced.
- `createMemo(fn)` — derived readonly value. `App.tsx` memoizes the status-bar
  message from `data.snapshot`.
- `onMount(fn)` / `onCleanup(fn)` — register a side effect scoped to the
  component's lifetime. Views register their key handler on mount and clear it
  on cleanup.
- `batch(fn)` — group multiple store writes so dependent effects run once.
  `createDialogStore.clear()` wraps the per-item `onClose` loop + `setStack([])`
  in `batch`.

Rules:

- Access reactive values inside JSX as function calls (`{tab()}`, `{count()}`)
  so the JSX transform (via the `@opentui/solid/preload` Bun plugin) wraps them
  as reactive getters. Reading them once into a `const` breaks reactivity.
- Keep domain calculations in `src/core/**`; signals/stores only carry
  **display** and **pending intent** state.

---

## OpenTUI Hooks

From `@opentui/solid`:

- `useKeyboard(handler)` — subscribe to key events. **There is no
  `stopPropagation`**; every subscriber receives the same key, so multiple
  subscriptions cause double dispatch. This repo subscribes **exactly once** at
  the AppShell (see Centralized Key Routing below).
- `useRenderer()` — returns the renderer; used to tear down on exit
  (`renderer.destroy()` then `process.exit(0)` in `App.tsx`).
- `useTerminalDimensions()` — returns an **accessor** `{ width, height }`. Call
  it as `dim().width`. Used for layout, dialog sizing, and overlay masks.
- `render(() => <App />, { exitOnCtrlC: false })` — entry point in
  `index.tsx`. `exitOnCtrlC: false` is required so the AppShell can decide
  whether `ctrl+c` closes the top dialog or exits the TUI.

---

## Centralized Key Routing

Because `useKeyboard` has no stop propagation, the AppShell owns the single
keyboard subscription and dispatches keys in priority order:

1. **Dialog open** → `ESC` / `ctrl+c` call `dialog.closeTop()`; other keys are
   swallowed (the active dialog's own `useKeyboard` handles them).
2. **View handler** → the current view registers a `ViewKeyHandler` via
   `useViewKey().setHandler`. Returning `true` means "consumed" (the AppShell
   does not run global keys, e.g. search mode swallows `1`/`2`/`3`/`a`); returning
   `false` falls through to global keys.
3. **Global keys** → `1`/`2`/`3` switch tabs, `ctrl+r` refreshes, `?` shows help,
   `ESC`/`ctrl+c` exit.

```ts
// src/tui/state/app-keys.ts (pure, tested in tests/tui/key-routing.test.ts)
export function createAppShellKeyHandler(deps: AppShellKeyDeps): (key: KeyEvent) => void
```

Rules for views:

- A view **must not** call `useKeyboard` itself. It registers a `ViewKeyHandler`
  via `useViewKey()` on mount and clears it on cleanup.
- A handler returns `boolean` (consumed vs. fallthrough). This is how `ctrl+r`
  stays a global refresh while `enter` triggers plan review inside the skill view.

---

## Owner Context (critical)

`useContext` resolves against the **owner** active when the reading component
was created. JSX built inside `useKeyboard`/async/event callbacks has no owner
and will throw "useX must be used within a Provider". Mitigations used in the
tree:

- Capture context values (`const theme = useTheme()`, `const dialog =
  useDialog()`) in the component body, then close over them in callbacks.
- For deferred dialog content, store an **element factory**
  `() => JSX.Element` and render it inside the `DialogProvider`'s `<Show>` (see
  `component-guidelines.md` → Element Factories).

---

## Data Fetching

There is no server data. All TUI data is local filesystem state:

- `ConfigStore.read()` → `AppConfig` (`config.toml`).
- `IndexStore.read()` → `IndexFile` (`index.json`).
- `StateStore.read()` → `StateFile`.
- `refreshIndex(config, state)` rebuilds `index.json` from sources.

`DataProvider` loads all three into a reactive `DataSnapshot` and exposes
`refresh()` (re-scan) and `reload()` (re-read from disk). Do not introduce HTTP
fetch / cache libraries.

---

## Naming

- Factory functions: `create*` (`createMatrixState`, `createDialogStore`,
  `createAppShellKeyHandler`).
- OpenTUI/Solid hooks: `use*` (`useTheme`, `useData`, `useDialog`, `useViewKey`,
  `useKeyboard`, `useRenderer`, `useTerminalDimensions`).
- `.tsx` when the file contains JSX (providers, components, views, dialogs);
  `.ts` for state/key-routing factories with no JSX.

---

## Common Mistakes

- Reading a signal/store into a `const` before JSX (`const t = tab(); ...
  <Show when={t}>`) — breaks reactivity; use `{tab()}` in JSX.
- Calling `useDialog`/`useTheme` inside `useKeyboard` or async callbacks — loses
  owner; capture the value in the component body.
- A view subscribing its own `useKeyboard` — double dispatch; register a
  `ViewKeyHandler` via `useViewKey()` instead.
- Forgetting `bunfig.toml`'s `preload = ["@opentui/solid/preload"]` — JSX stops
  being reactive.
- Writing a signal inside a `createEffect` that the same effect reads (even
  transitively) — triggers an infinite recompute (`Maximum call stack`). E.g.
  an effect that calls `matrix.realign(...)` already depends on `cursor()`;
  calling `matrix.move()` (which `setCursor`s) inside that same effect
  re-schedules it forever. Do clamp/state writes in non-effect callbacks
  (key/event handlers) or wrap the write in `untrack`; never inside an effect
  that already depends on the signal.
- `usePaste(callback)` from `@opentui/solid` is the supported hook for terminal
  paste (cmd+v / bracketed paste); add it alongside `useKeyboard` in input
  dialogs (`PromptDialog`). `useKeyboard` char capture alone drops pasted text.
