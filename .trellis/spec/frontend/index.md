# Frontend Development Guidelines

> Frontend and future TUI guidance for Agent Skills Mesh.

---

## Overview

Agent Skills Mesh currently has no production Web frontend and no implemented TUI. The existing product surface is a TypeScript CLI backed by core services. Frontend guidelines document this current absence and define boundaries for the planned Ink/React terminal UI so future agents do not invent browser patterns that do not exist in the repository.

Evidence:

- `src/` contains `cli/`, `core/`, and `utils/`, with no `tui/` directory.
- `package.json` has `cac` and `gray-matter` runtime dependencies, but no React/Ink runtime dependencies.
- `.trellis/tasks/archive/2026-07/07-02-agent-skills-mesh/design.md` plans a future Ink/React TUI with Matrix, Discover, and Doctor screens.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Current no-frontend state and planned `src/tui/**` boundary | Active |
| [Component Guidelines](./component-guidelines.md) | Future Ink/React component boundaries and props guidance | Active |
| [Hook Guidelines](./hook-guidelines.md) | Current no-hook state and future hook constraints | Active |
| [State Management](./state-management.md) | Current config/index/plan state model and future pending-plan flow | Active |
| [Quality Guidelines](./quality-guidelines.md) | Verification and safety requirements for future TUI work | Active |
| [Type Safety](./type-safety.md) | Reusing strict TypeScript core model types in UI code | Active |

---

## Non-Applicable Areas

The following do not apply until a real Web frontend is introduced:

- Browser routing frameworks.
- CSS modules, Tailwind, styled-components, or asset pipelines.
- DOM event and browser accessibility APIs.
- Server-side rendering or client/server data fetching libraries.

Future TUI work should follow terminal UI constraints and reuse the existing core service layer.

---

**Language**: All documentation in this spec directory is written in **English**.
