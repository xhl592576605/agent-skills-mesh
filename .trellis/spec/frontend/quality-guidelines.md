# Quality Guidelines

> Code quality standards for the SolidJS + OpenTUI TUI.

---

## Current State

The TUI is implemented under `src/tui/**` on Bun + SolidJS + OpenTUI. Domain
logic stays in `src/core/**`; the TUI is a thin interactive layer. Verification
commands (see `package.json`):

```bash
pnpm typecheck          # tsc --noEmit
pnpm test               # vitest run (node worker)
bun run vitest run tests/tui/   # vitest under Bun (enables OpenTUI native FFI)
bun run src/cli/index.ts <cmd>  # run from source during development
```

The project does not define a lint script; rely on `tsc --strict` and review.

---

## Forbidden Patterns

- Adding browser frontend scaffolding (DOM, CSS, routing) for TUI work.
- Reintroducing the removed JSX framework dependencies or classic JSX runtime;
  the TUI is SolidJS with `jsx: "preserve"` and the `@opentui/solid/preload`
  Bun transform plugin.
- Putting filesystem mutation logic in components, state factories, or dialogs.
- Bypassing core service plans for install/uninstall/repair actions.
- Modifying `src/core/**` from a TUI task (TUI work is core-zero-change;
  extend core in a separate task).
- Tests that depend on the user's real `~/.pi/agent/skills`,
  `~/.claude/skills`, `~/.codex/skills`, or `~/.agent-skills-mesh` directories —
  use temp dirs or `ASM_HOME`.

---

## Required Patterns

- Load config/index/state through `ConfigStore`, `IndexStore`, `StateStore`
  (via `DataProvider`).
- Use typed services from `src/core/services/**` for refresh, doctor, install,
  uninstall, and repair.
- Generate a pending plan and confirm via a `*Dialog.show()` `Promise` before
  applying filesystem changes.
- Derive display state from typed core data (`projection.ts`, `filterSkills`).
- Use terminal-safe text + symbols; never rely on color alone.
- Respect APFS case-insensitivity: never keep `app.tsx` + `App.tsx` or
  `index.ts` + `index.tsx` together (see `directory-structure.md`).

Reference files:

- `src/core/services/install-service.ts` — plan/apply separation.
- `src/core/services/doctor-service.ts` — typed diagnostics + `DoctorFix`.
- `tests/install-service.test.ts` — temp-dir filesystem test pattern.
- `tests/tui/` — OpenTUI test patterns (see below).

---

## Testing Requirements

Two tiers, both must stay green:

### 1. Pure-function tests (run under node or Bun)

State factories and key-routing handlers are pure functions extracted
specifically so they can be tested without a renderer. These run under the
default `vitest run` (node worker).

- `tests/tui/matrix.test.ts` — `createMatrixState` cursor/pending,
  `projection.ts` columns/cellKind/cellInfo/cellColor, `filterSkills`,
  `createSkillAgentKeyHandler` matrix/search key routing.
- `tests/tui/dialog.test.ts` — `createDialogStore` replace/closeTop/clear and
  `ConfirmDialog`/`SelectDialog`/`PromptDialog` `show()` Promise semantics via a
  real store.
- `tests/tui/key-routing.test.ts` — `createAppShellKeyHandler` priority
  (dialog → view → global) including `ctrl+r` vs `r` disambiguation.
- `tests/tui/source-keys.test.ts` — `createSourceKeyHandler` write-callback
  dispatch + `moveCursor` clamp.

### 2. Renderer tests (run under Bun only)

OpenTUI's native FFI is available **only under the Bun runtime**. A node
vitest worker throws `OpenTUI native FFI is not available for this runtime
yet`. Guard renderer tests with a native-availability probe and
`describe.skipIf`:

```ts
// tests/tui/render-smoke.test.tsx
let nativeOk = false
try {
  const { testRender } = await import("@opentui/solid")
  const t = await testRender(() => null as never, { width: 2, height: 2 })
  t.renderer.destroy()
  nativeOk = true
} catch { nativeOk = false }

describe.skipIf(!nativeOk)("testRender smoke — Matrix component", () => { ... })
```

Run them with `bun run vitest run tests/tui/`. Use `testRender` +
`t.flush()` + `t.captureCharFrame()` for snapshot-style string assertions, and
`t.mockInput.pressEnter()` / `pressKeys([KeyCodes.RETURN])` for input.

### Mock-input quirks (critical)

- `mockInput.pressKey("escape")` sends the literal string char-by-char and does
  **not** produce an ESC key event. Use `pressEscape()`, `pressEnter()`,
  `pressArrow("left"|"up"|"down"|"right")`, or
  `pressKeys([KeyCodes.RETURN | ESCAPE | ARROW_UP])`.
- Under `pressEscape()` in mock mode, `KeyEvent.name` may be the empty string
  rather than `"escape"` — this is a mock limitation. For ESC / key-routing
  assertions, **test the pure handler directly** by constructing a `KeyEvent`
  literal; do not depend on `pressEscape()`.
- Letter keys: `key.name` is always **lowercase**; the shift state is on
  `key.shift`. `parseKeypress("F")` yields `{ name: "f", shift: true }`, so
  detect an uppercase letter with `key.name === "f" && key.shift`, **never**
  `key.name === "F"` (it never matches). The `DoctorView` `f` (fix) / `F`
  (fix-all) dispatch relies on this and checks the shift branch first.

---

## Code Review Checklist

- [ ] Does UI code reuse core models instead of duplicating them?
- [ ] Are filesystem mutations routed through plan → dialog confirm → apply →
      refresh/reload?
- [ ] Is `src/core/**` untouched by the change?
- [ ] Do status indicators remain readable without color (symbol/text paired)?
- [ ] Are key-routing changes covered by pure-function tests, and any renderer
      test guarded with `describe.skipIf(!nativeOk)`?
- [ ] Do new files respect APFS case-insensitivity (no `app.tsx`/`App.tsx` or
      `index.ts`/`index.tsx` collisions)?
- [ ] Do `pnpm typecheck` and `pnpm test` pass for touched code, and do
      `bun run src/cli/index.ts --help | source list | doctor` behave unchanged?
