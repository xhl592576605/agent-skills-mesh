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

## When to Use Global State

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
- Do not introduce a global state library for the current CLI-only codebase.
