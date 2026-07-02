# State Management

> How UI state is managed in this project.

---

## Current State

There is no frontend state management implementation today. The current application state is local CLI/core data stored in typed objects and files:

- User intent: `AppConfig` from `src/core/models/config.ts`, persisted as `config.toml` by `ConfigStore`.
- Generated facts: `IndexFile` from `src/core/models/index.ts`, persisted as `index.json` by `IndexStore`.
- Install decisions: `InstallPlan` / `UninstallPlan` from `src/core/models/install-plan.ts`, built by `src/core/services/install-service.ts`.
- Health findings: `DoctorCheck[]` from `src/core/services/doctor-service.ts`.

No Redux, Zustand, React Context, React Query, or browser URL state exists.

---

## State Categories

Use these categories when implementing future UI behavior:

- Persisted user state: `config.toml`; modify only through storage/service code that preserves explicit user intent.
- Generated scan state: `index.json`; refresh from sources rather than hand-editing in UI code.
- Pending UI state: selections, filters, matrix edits, and not-yet-applied install plans in a future TUI.
- Derived display state: matrix symbols, filtered skill lists, and doctor summaries derived from typed core data.

---

## Future TUI Pattern

The archived design requires the TUI to operate on pending plans and not directly mutate the filesystem. Preserve this flow:

```txt
Idle -> SelectingSkill -> EditingMatrix -> PendingPlan -> ReviewPlan -> Applying -> RefreshIndex -> Idle
```

Practical rules:

- Keep user edits pending until a plan is generated and reviewed.
- Use `buildInstallPlan()` and `buildUninstallPlan()` to represent filesystem changes.
- Use `applyInstallPlan()` and `applyUninstallPlan()` only after confirmation.
- Refresh the index after applied changes so UI state reflects filesystem reality.

---

## Config Mutation Requires Full Snapshot Reload

The TUI snapshot is a single `{ config, index }` pair sourced from `useIndexState`. After any action that mutates `config.toml` (adopt / ignore / unignore / prefer, which write user-intent overrides), the snapshot must be reloaded **whole** — re-read both `config` and `index` — not just the `index`.

**Why**: These operations change the *user-intent* layer (`config.toml`), not the *scan-facts* layer (`index.json`). If the UI only updates `index` while keeping the stale `config`, the next `refreshIndex(config, index)` closes over the stale config and silently drops the just-written `managed` / `ignored` / `preferredSourceId` overrides — Matrix and Discover then drift from filesystem reality.

```ts
// useDiscover: adopt/ignore write config.toml → must reload (re-read config + index)
async function adopt(skillName: string) {
  await adoptSkill(configStore, indexStore, skillName); // writes config + refreshes index
  reload();                                             // re-read BOTH config and index
}

// useDoctor: repair mutates only the filesystem (no config change) → refresh() is enough,
// but the App-level effect must still SET_SNAPSHOT with the fresh {config, index} pair.
```

**Related**: See `src/tui/App.tsx` effect that dispatches `SET_SNAPSHOT` after `useIndexState.reload()` / `refresh()`. Never rebuild half of the snapshot.



There is no global UI store today. If the Ink TUI grows beyond simple prop passing, use a minimal local TUI state container only for cross-screen concerns such as:

- Current selected skill/agent.
- Active screen.
- Pending install/uninstall plans.
- Last loaded config/index snapshot.

Do not put core domain rules or filesystem mutation logic into a UI store.

---

## Server State

No server state exists. All current state is local file and filesystem state. Do not add server-cache abstractions unless a remote marketplace or API is introduced in a separate product change.

---

## Common Mistakes

- Do not store generated scan facts in `config.toml`.
- Do not let UI state become the source of truth for installed symlinks; refresh/detect from the filesystem.
- Do not apply changes directly while editing a matrix cell.
- After a config-mutating action (adopt/ignore/prefer), do not dispatch a snapshot that pairs a stale `config` with a fresh `index` — reload both, or the next `refresh` drops the new overrides (see "Config Mutation Requires Full Snapshot Reload" above).
- Do not introduce a global state library for the current CLI-only codebase.
