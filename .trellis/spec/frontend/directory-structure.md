# Directory Structure

> How TUI code is organized under `src/tui/**`.

---

## Current State

The TUI lives under `src/tui/` and is implemented with SolidJS + OpenTUI. The
tree (real files):

```txt
src/tui/
├── index.tsx                # run() export + render(() => <App/>) (JSX ⇒ .tsx)
├── App.tsx                  # Provider assembly + AppShell (centralized key routing)
├── theme/
│   └── index.ts             # RGBA theme: Theme interface + theme constant
├── context/                 # Solid Context (Provider/use pattern)
│   ├── theme.tsx            # ThemeProvider + useTheme
│   ├── data.tsx             # DataProvider + useData (config/index/state snapshot)
│   ├── dialog.tsx           # DialogProvider + useDialog + createDialogStore
│   └── view-key.tsx         # ViewKeyProvider + useViewKey (centralized routing contract)
├── state/                   # Reactive state primitives + pure key-routing functions
│   ├── app-keys.ts          # createAppShellKeyHandler (pure, testable)
│   ├── matrix.ts            # createMatrixState (cursor + pending intents)
│   ├── projection.ts        # buildAgentColumns / baseCellKind / cellInfo / cellColor / installationKey
│   ├── search.ts            # createSearchState + filterSkills
│   ├── skill-agent-keys.ts  # createSkillAgentKeyHandler + toggle/row-all helpers
│   └── source-keys.ts       # createSourceKeyHandler + moveCursor
├── components/
│   ├── AppHeader.tsx        # top product title + summary counts
│   ├── TabBar.tsx           # tab strip with active underline
│   ├── Panel.tsx            # reusable bordered visual container
│   ├── Matrix.tsx           # skill×agent grid (pure render, state via props)
│   ├── Inspector.tsx        # skill detail panel/card
│   ├── SearchBar.tsx        # "/" fuzzy trigger
│   └── StatusBar.tsx        # bottom keycap hints/status (accepts `hints` prop)
├── dialogs/
│   ├── Dialog.tsx           # base overlay (position absolute + zIndex + RGBA mask)
│   ├── ConfirmDialog.tsx    # show(): Promise<boolean>
│   ├── SelectDialog.tsx     # show(): Promise<item | undefined>
│   ├── PromptDialog.tsx     # show(): Promise<string | undefined>
│   ├── AddSourceDialog.tsx
│   ├── SkillDetailDialog.tsx
│   ├── MultiSelectDialog.tsx
│   ├── AddAgentDialog.tsx
│   ├── AgentManagerDialog.tsx
│   └── SkillMdDialog.tsx
└── views/
    ├── SkillAgentView.tsx   # tab 1 (matrix + search + inspector)
    ├── SourceView.tsx       # tab 2 (sources CRUD)
    └── DoctorView.tsx       # tab 3 (runDoctor + fix)
```

---

## APFS Naming Constraint (case-insensitive filesystems)

macOS APFS is **case-insensitive but case-preserving**. Two files whose names
differ only by case collide on disk and silently break imports. Concretely:

- Do **not** keep `app.tsx` and `App.tsx` together.
- Do **not** keep `index.ts` and `index.tsx` together.

This repo resolves it as: the entry is **`index.tsx`** (it contains JSX in the
`run()` export and the `render()` call) and the root component is **`App.tsx`**.
There is no `app.tsx` and no plain `index.ts` under `src/tui/`.

---

## Module Organization

- **Domain logic stays in `src/core/**`.** TUI code reads typed service outputs
  (`runDoctor`, `refreshIndex`, `buildInstallPlan`, `buildRepairPlan`,
  `applyRepairPlan`, …) and never reimplements scanning/install/doctor logic.
- **State is split into focused reactive primitives** under `src/tui/state/`
  rather than one global reducer. Each file owns one concern (matrix cursor,
  projection, search, key routing for one view).
- **Key-routing logic is pure functions** (`createAppShellKeyHandler`,
  `createSkillAgentKeyHandler`, `createSourceKeyHandler`) so tests can assert
  dispatch behavior without a renderer. Components only wire them via context.
- **Filesystem mutation always goes through a generated plan + confirmation
  dialog**, then `data.reload()`/`data.refresh()` writes the new snapshot back.
  TUI code never creates install entries directly.
- Keep reusable non-UI helpers in `src/utils/**`, not under `src/tui/**`.

---

## Naming Conventions

- Backend/service files: kebab-case `.ts` (`install-service.ts`, `config-store.ts`).
- SolidJS component/view/dialog files: PascalCase `.tsx` (`Matrix.tsx`,
  `SkillAgentView.tsx`, `ConfirmDialog.tsx`).
- Reactive state + key-routing modules: kebab-case `.ts` (`matrix.ts`,
  `app-keys.ts`, `skill-agent-keys.ts`).
- Context providers that contain JSX (Provider component): `.tsx`
  (`theme.tsx`, `data.tsx`, `dialog.tsx`, `view-key.tsx`).

---

## Examples

- `src/cli/index.ts` formats typed service results; the TUI does the same for
  terminal output (`DoctorView` consumes `DoctorCheck[]` from
  `src/core/services/doctor-service.ts`).
- `src/tui/state/projection.ts` derives `CellKind` + label/color from
  `IndexFile.installations` — pure functions, reusable and testable.
- `src/tui/dialogs/ConfirmDialog.tsx` returns `Promise<boolean>` from `show()`
  so callers can `await` confirmation before applying a plan.

---

## Non-Applicable Rules

Browser routing, CSS asset organization, DOM accessibility patterns, and server
rendering do not apply: there is no browser frontend.
