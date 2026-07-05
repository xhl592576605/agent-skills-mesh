# Type Safety

> Type safety patterns for the SolidJS + OpenTUI TUI.

---

## Current State

The project uses strict TypeScript for CLI/core/TUI alike. TUI code reuses core
model types and adds only display-specific types. There is no separate untyped
UI model.

Evidence:

- `tsconfig.json`: `strict`, `moduleResolution: "NodeNext"`,
  `forceConsistentCasingInFileNames`, `jsx: "preserve"`,
  `jsxImportSource: "@opentui/solid"`.
- Domain contracts live in `src/core/models/**`.
- SolidJS ships first-class types via `solid-js` (`JSX`, `ParentProps`,
  `Accessor`) and `@opentui/solid` (`KeyEvent`, `MouseEvent`, hook signatures).
- `@opentui/core` provides `RGBA`, `TextAttributes`, and key event types.

---

## Type Organization

Use core types as the source of truth:

- Config and agents: `src/core/models/config.ts` (`AppConfig`, `AgentConfig`,
  `SourceConfig`).
- Index and issues: `src/core/models/index.ts` (`IndexFile`, `IssueRecord`).
- Skills and candidates: `src/core/models/skill.ts` (`SkillRecord`,
  `SkillCandidate`).
- Install records: `src/core/models/installation.ts` (`InstallationRecord`).
- Install plans/actions: `src/core/models/install-plan.ts` (`InstallAction`,
  `InstallPlan`, `UninstallPlan`).
- State file: `src/core/models/state.ts` (`StateFile`).
- Doctor: `src/core/services/doctor-service.ts` (`DoctorCheck`, `DoctorFix`).

TUI-specific types describe **display/pending state only**, for example
`MatrixState`/`Cursor`/`PendingMap`/`Intent` (`src/tui/state/matrix.ts`),
`AgentColumn`/`CellKind`/`CellInfo` (`src/tui/state/projection.ts`),
`DialogStackItem`/`DialogContextValue` (`src/tui/context/dialog.tsx`), and
`ViewKeyHandler` (`src/tui/context/view-key.tsx`). A skill candidate still uses
`SkillCandidate`; a cell status still uses the core installation status union.

---

## Validation

There is no runtime validation library. The current code uses lightweight
parsing and TypeScript types:

- `ConfigStore` parses simple TOML-like assignments into `AppConfig`.
- `SkillScanner` narrows `gray-matter` frontmatter with `typeof` and
  `Array.isArray` checks.
- `IndexStore`/`StateStore` cast parsed JSON to `IndexFile`/`StateFile`.

If future UI accepts user-edited config values (e.g. `PromptDialog`), validate
at the boundary before calling core services. Do not rely on component props
alone for filesystem paths or agent ids.

---

## Common Patterns

- Use discriminated unions for action/status, as in `InstallAction`, the
  installation status types, and `Intent = "install" | "uninstall"`.
- Use explicit function return types for exported factories
  (`createMatrixState(): MatrixState`, `buildAgentColumns(...): AgentColumn[]`,
  `cellInfo(...): CellInfo`).
- Preserve ESM import extensions (`.js`) in TypeScript source, matching
  `src/cli/index.ts` and every `src/tui/**` import.
- For element factories stored on the dialog stack, type them as
  `() => JSX.Element` (JSX comes from `solid-js`) — see
  `component-guidelines.md` → Element Factories.
- For key handlers, use `ViewKeyHandler = (key: KeyEvent) => boolean`
  (`KeyEvent` from `@opentui/core`).

---

## Forbidden Patterns

- Duplicating core model types in TUI code (re-import them instead).
- Using `any` for plan actions, skill records, doctor checks, or config values
  when a model type exists.
- Casting untrusted user input directly to `AgentConfig`, `SourceConfig`, or
  `InstallAction` without validation.
- Introducing browser-only types (`HTMLElement`, DOM events) — the TUI uses
  OpenTUI key/mouse event types.
