# Frontend Development Guidelines

> TUI guidance for Agent Skills Mesh (SolidJS + OpenTUI on Bun).

---

## Overview

The user-facing surface of Agent Skills Mesh is a **terminal UI** built with
**[SolidJS](https://www.solidjs.com/) + [`@opentui/solid`](https://github.com/sst/opentui)**,
running on the **Bun** runtime. There is no browser/Web frontend. The TUI renders
the same core services that the text CLI uses, so domain behavior stays in
`src/core/**` and the TUI is a thin interactive layer over typed service outputs.

Evidence (current tree):

- `src/tui/**` exists and is implemented (entry `src/tui/index.tsx` +
  `src/tui/App.tsx`, plus `theme/`, `context/`, `state/`, `components/`,
  `dialogs/`, `views/`).
- `package.json` runtime dependencies: `@opentui/core`, `@opentui/solid`,
  `@opentui/keymap` (locked to `^0.4.3`), `solid-js`, `commander`, `gray-matter`.
- `package.json` scripts: `dev` runs `bun run src/cli/index.ts`; `test` runs
  `vitest run`; `typecheck` runs `tsc --noEmit`.
- `bunfig.toml` preloads `@opentui/solid/preload` so the Solid JSX transform
  produces reactive getters under Bun.
- `tsconfig.json` uses `jsx: "preserve"` + `jsxImportSource: "@opentui/solid"`
  (the Solid transform is applied by the Bun preload plugin, **not** by a
  classic runtime).

The CLI (`src/cli/index.ts`) lazily imports the TUI via
`const { run } = await import("../tui/index.js")` inside the `tui` command, and
keeps a TTY check so non-TTY contexts degrade to text output.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Real `src/tui/**` layout and APFS naming constraint | Active |
| [Component Guidelines](./component-guidelines.md) | OpenTUI `box`/`text` primitives, props, portals, element factories | Active |
| [Solid Patterns](./solid-patterns.md) | Signals/stores/effects, `useKeyboard`, `useViewKey`, owner-context pitfalls | Active |
| [State Management](./state-management.md) | Snapshot store, pending matrix state, dialog stack, centralized key routing | Active |
| [Quality Guidelines](./quality-guidelines.md) | OpenTUI testing, color-free safety, dialog confirm model, core-zero-change | Active |
| [Type Safety](./type-safety.md) | Reusing strict core model types in SolidJS code | Active |

---

## Non-Applicable Areas

The following do not apply to this codebase:

- Browser routing frameworks, CSS modules, Tailwind, styled-components, asset pipelines.
- DOM event and browser accessibility APIs (the TUI uses OpenTUI key/mouse events).
- Server-side rendering or client/server data fetching libraries.

All TUI data is local filesystem state read through `ConfigStore`, `IndexStore`,
and `StateStore`; never invent HTTP/cache abstractions.

---

**Language**: All documentation in this spec directory is written in **English**.
