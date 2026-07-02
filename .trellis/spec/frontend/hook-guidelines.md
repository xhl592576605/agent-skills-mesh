# Hook Guidelines

> Hook conventions for the future Ink/React TUI.

---

## Current State

There are no React hooks in the current codebase. The project is a CLI/core TypeScript application, and no `src/tui/hooks/` directory exists.

Evidence:

- `src/` contains only `cli/`, `core/`, and `utils/`.
- `package.json` does not include React, Ink, React Query, SWR, or other hook-oriented UI dependencies.
- Future TUI work is described in `.trellis/tasks/archive/2026-07/07-02-agent-skills-mesh/design.md`, but it has not been implemented.

---

## Future Custom Hook Patterns

If an Ink/React TUI is added, hooks should coordinate UI state and service calls, not own domain rules.

Recommended boundaries:

- Hooks may load config/index state through storage classes from `src/core/storage/**`.
- Hooks may call service functions such as `runDoctor()`, `refreshIndex()`, `buildInstallPlan()`, and `buildUninstallPlan()`.
- Hooks should keep pending UI state separate from persisted data until the user confirms an action.
- Domain calculations should remain in `src/core/services/**` so CLI, tests, and TUI share the same behavior.

---

## Data Fetching

There is no server data fetching in this project. Current data is local filesystem state:

- `ConfigStore.read()` reads `config.toml`.
- `IndexStore.read()` reads `index.json`.
- `refreshIndex()` scans local skill sources and agent directories.

Do not introduce React Query, SWR, or HTTP client patterns for the current local CLI/TUI use case.

---

## Naming Conventions

If hooks are introduced for the TUI:

- Use `use*` names, such as `useIndexState`, `useDoctorChecks`, or `useInstallPlan`.
- Keep hook files under `src/tui/hooks/`.
- Use `.ts` when no JSX is returned; use `.tsx` only when JSX is needed.
- Reuse core types rather than creating separate hook-specific data models.

---

## Common Mistakes

- Do not add hooks before adding the TUI runtime and dependencies.
- Do not place reusable service logic inside hooks.
- Do not make a hook mutate symlinks directly; build a plan, surface it to the UI, and apply only after confirmation.
- Do not add browser data-fetching libraries for local file reads.
