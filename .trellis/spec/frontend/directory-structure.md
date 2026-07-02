# Directory Structure

> How frontend and future TUI code are organized in this project.

---

## Current State

Agent Skills Mesh currently has no production Web frontend and no implemented TUI source directory. The repository only contains the CLI/core TypeScript implementation under `src/cli/**`, `src/core/**`, and `src/utils/**`.

Evidence:

- `package.json` has no `react` or `ink` dependency today.
- `src/` contains `cli/`, `core/`, and `utils/`, but no `tui/`, `components/`, or Web app directory.
- Archived design notes in `.trellis/tasks/archive/2026-07/07-02-agent-skills-mesh/design.md` plan a future Ink/React TUI, not a browser frontend.

---

## Planned TUI Boundary

If the TUI is implemented, keep it separate from the CLI/core layers:

```txt
src/
├── cli/                      # CLI command parsing and text output
├── core/                     # models, services, scanners, storage
├── tui/                      # future Ink/React terminal UI only
│   ├── App.tsx
│   ├── screens/
│   │   ├── MatrixScreen.tsx
│   │   ├── DiscoverScreen.tsx
│   │   └── DoctorScreen.tsx
│   └── components/
│       ├── Layout.tsx
│       ├── SkillInspector.tsx
│       └── InstallPlanModal.tsx
└── utils/                    # non-UI helpers shared by CLI/core
```

This planned layout comes from the archived technical design, but the directories should be created only when the TUI work actually starts.

---

## Module Organization

- Do not create a Web `pages/`, `app/`, `public/`, or asset pipeline unless a real Web frontend is added.
- Future TUI screens should call core services and storage through typed APIs; they should not duplicate scanner, install, or doctor logic.
- Future TUI components should render data and collect user intent. Filesystem mutation must still go through install/uninstall plans from `src/core/services/install-service.ts`.
- Keep reusable non-UI helpers in `src/utils/**`, not under `src/tui/**`.

---

## Naming Conventions

Current repository conventions are TypeScript ESM with kebab-case non-component files:

- Backend/service files use names such as `install-service.ts`, `config-store.ts`, and `skill-scanner.ts`.
- Future React component and screen files may use PascalCase `.tsx` names as planned in the design (`MatrixScreen.tsx`, `Layout.tsx`).
- Future TUI-only hooks, if added, should live under `src/tui/hooks/` and use `use*.ts` or `use*.tsx` names.

---

## Examples

Current examples to follow for frontend-adjacent boundaries:

- `src/cli/index.ts` formats typed service results without owning domain logic; the TUI should do the same for terminal UI output.
- `src/core/services/doctor-service.ts` returns `DoctorCheck[]`, which can be reused by a future Doctor screen.
- `src/core/services/install-service.ts` returns install/uninstall plans, which can be reused by a future plan review modal.

---

## Non-Applicable Rules

Browser routing, CSS asset organization, DOM accessibility patterns, and server rendering do not apply to the current codebase because there is no browser frontend.
