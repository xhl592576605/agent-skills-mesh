# State Management

> How TUI state is managed in the SolidJS + OpenTUI TUI.

---

## Current State

There is no global reducer and no Redux/Zustand. TUI state is a set of focused
reactive primitives in `src/tui/state/` plus a snapshot store in
`src/tui/context/data.tsx`. Domain truth still lives in typed core data:

- User intent: `AppConfig` from `src/core/models/config.ts`, persisted as
  `config.toml` by `ConfigStore`.
- Generated facts: `IndexFile` from `src/core/models/index.ts`, persisted as
  `index.json` by `IndexStore`.
- Cross-run state: `StateFile` from `src/core/models/state.ts`, persisted by
  `StateStore`.
- Install decisions: `InstallPlan` / `UninstallPlan` / repair plans from
  `src/core/services/install-service.ts`.
- Health findings: `DoctorCheck[]` / `DoctorFix` from
  `src/core/services/doctor-service.ts`.

---

## State Categories

- **Persisted user state** (`config.toml`): modify only through storage/service
  code that preserves explicit user intent.
- **Generated scan state** (`index.json`): refresh from sources, never hand-edit
  in UI code.
- **Snapshot** (`DataSnapshot` in `DataProvider`): `{ config, index, state,
  loading, error }` — the TUI's readonly view of the on-disk truth.
- **Pending UI state**: matrix cursor + pending install/uninstall intents
  (`createMatrixState`), search query (`createSearchState`), view-local
  selections. Kept separate from persisted data until the user confirms.
- **Derived display state**: matrix cell kind/label/color (`projection.ts`),
  filtered skill lists (`filterSkills`), doctor summaries — pure functions over
  typed core data.

---

## Reactive Stores

- `DataProvider` holds a `createStore<DataSnapshot>` and exposes `snapshot`,
  `refresh()` (re-scan sources, write `index.json`, update snapshot), and
  `reload()` (re-read config/state/index from disk). Views read
  `useData().snapshot` reactively; writes happen via services, then the snapshot
  is refreshed.
- `createMatrixState()` holds cursor (`{row,col}`), `scrollOffset`, and pending
  intents (`PendingMap = Record<skillName, Record<agentId, Intent>>` where
  `Intent = "install" | "uninstall"`). It exposes `setIntent`/`clearIntent`/
  `clearRow`/`clearAll`/`move`/`realign`.
- `createDialogStore()` holds the dialog stack and exposes `replace`/`closeTop`/
  `clear`/`isOpen`/`stack` (see Dialog Stack below).

There is no single dispatcher; each store owns its own transitions, and key
routing is centralized (see `solid-patterns.md` → Centralized Key Routing).

---

## Pending → Plan → Apply Flow

The TUI never writes the filesystem from a key press. Preserve this flow:

```txt
Idle → Selecting skill → Editing matrix (pending intents)
     → Review plan (ConfirmDialog) → Apply plan (core service)
     → refresh()/reload() snapshot → Idle
```

Rules:

- Keep user edits as **pending intents** in `createMatrixState` until a plan is
  generated.
- Build a plan with `buildInstallPlan()` / `buildUninstallPlan()` /
  `buildRepairPlan()` from `src/core/services/install-service.ts`.
- Apply with `applyInstallPlan()` / `applyUninstallPlan()` / `applyRepairPlan()`
  only after a `ConfirmDialog.show()` resolves `true`.
- After applying, call `data.reload()` (config-mutating actions) or
  `data.refresh()` (index-only), so the snapshot reflects disk reality.

---

## Config Mutation Requires Full Snapshot Reload

The snapshot is a single `{ config, index, state }` triple sourced from
`DataProvider`. After any action that mutates `config.toml` (adopt / ignore /
unignore / prefer, which write user-intent overrides), the snapshot must be
reloaded **whole** — re-read both `config` and `index` — not just the `index`.

**Why**: these operations change the *user-intent* layer (`config.toml`), not
the *scan-facts* layer (`index.json`). If the UI updates only `index` while
keeping a stale `config`, the next `refreshIndex(config, state)` closes over the
stale config and silently drops the just-written `managed` / `ignored` /
`preferredSourceId` overrides — Matrix and Doctor then drift from filesystem
reality.

```ts
// adopt/ignore write config.toml → reload BOTH config and index
async function adopt(skillName: string) {
  await adoptSkill(configStore, indexStore, skillName) // writes config + refreshes index
  await data.reload()                                  // re-read config AND index
}

// doctor repair mutates only the filesystem (no config change) → refresh() is enough,
// but the snapshot must still reflect the fresh {config, index} pair afterwards.
```

Never rebuild half of the snapshot. `DataProvider.reload()` reads the whole
triple; prefer it over ad-hoc partial updates.

---

## Dialog Stack

`createDialogStore()` (in `src/tui/context/dialog.tsx`) is a reactive stack of
`{ element, onClose }` items. Semantics (covered by
`tests/tui/dialog.test.ts`):

- `replace(element, onClose)` — invoke `onClose` for every item in the old
  stack, then replace the whole stack with a single new item.
- `closeTop()` — invoke the top item's `onClose`, then remove it (ESC/ctrl+c).
- `clear()` — in a `batch`, invoke every item's `onClose`, then empty the stack
  (overlay-mask click).
- `isOpen()` — `stack.length > 0`; the AppShell uses it to yield global keys.
- `push(element, onClose?)` — append a new item on top **without** invoking
  the lower stack's `onClose`. Use this to overlay a sub-dialog on top of a
  live one (e.g. pressing `i` inside `MultiSelectDialog` to view a SKILL.md).
  Closing the top via `closeTop` returns the lower dialog as top, its
  `onClose`/Promise untouched. **Never use `replace` to show a sub-dialog over
  a live dialog** — `replace` invokes the lower stack's `onClose` (resolving
  its Promise with the cancel value), terminating the underlying flow and
  losing user input.

`ConfirmDialog.show()`, `SelectDialog.show()`, and `PromptDialog.show()` all
resolve their `Promise` from both the explicit choice and the `onClose` path,
so ESC / mask click / ctrl+c are uniformly treated as cancel.

---

## Common Mistakes

- Storing generated scan facts in `config.toml`.
- Letting UI state become the source of truth for installed skill entries — always
  refresh/detect from the filesystem via `DataProvider`.
- Applying a plan directly while editing a matrix cell — generate → confirm →
  apply.
- After a config-mutating action, refreshing only `index` while keeping a stale
  `config` (see "Config Mutation Requires Full Snapshot Reload").
- Introducing a global state library; the focused stores + context are enough.
