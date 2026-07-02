# Component Guidelines

> Component conventions for the future Ink/React TUI.

---

## Current State

There are no production React components in this repository today. Do not invent Web component patterns or add component directories for unrelated CLI/core work.

Evidence:

- `package.json` does not currently depend on `react` or `ink`.
- `src/` has no `tui/` or `components/` directory.
- The archived design in `.trellis/tasks/archive/2026-07/07-02-agent-skills-mesh/design.md` describes a future terminal TUI with Ink/React screens: Matrix, Discover, and Doctor.

---

## Future TUI Component Boundary

When TUI implementation starts:

- Build terminal UI components, not browser components.
- Keep domain behavior in `src/core/services/**` and pass typed data into components.
- Use components for rendering and interaction only.
- Generate install/uninstall plans before applying any filesystem mutation.

Useful existing service outputs:

- `DoctorCheck[]` from `src/core/services/doctor-service.ts` for a Doctor screen.
- `InstallPlan` / `UninstallPlan` from `src/core/services/install-service.ts` for plan review UI.
- `IndexFile.skills` and `IndexFile.installations` from `src/core/models/index.ts` for a Matrix screen.

---

## Component Structure

No component file structure is enforced yet. If Ink/React is added, prefer small typed components such as:

```txt
src/tui/components/Layout.tsx
src/tui/components/SkillInspector.tsx
src/tui/components/InstallPlanModal.tsx
src/tui/screens/MatrixScreen.tsx
src/tui/screens/DiscoverScreen.tsx
src/tui/screens/DoctorScreen.tsx
```

Keep rendering components separate from service calls when practical so the same service behavior remains testable without a terminal renderer.

---

## Props Conventions

Future component props should use explicit TypeScript interfaces and reuse core model types where possible:

- Import `SkillRecord`, `InstallationRecord`, `InstallPlan`, and `DoctorCheck` from existing core modules instead of redefining UI-specific copies.
- Prefer readonly props for data passed from loaded config/index state.
- Pass callbacks for user intent, such as selecting a skill or confirming a plan; callbacks should call core services outside low-level presentational components.

---

## Styling Patterns

No styling system exists today. For a future Ink TUI:

- Use Ink primitives and terminal-safe layout rather than CSS, DOM classes, or browser-only styling libraries.
- Keep symbols consistent with the design: `✓ installed`, `○ available`, `× unsupported`, `! conflict`, `~ pending`.
- Avoid introducing Tailwind, CSS modules, or browser style tooling unless a Web frontend is explicitly added.

---

## Accessibility and UX

Browser accessibility rules are not directly applicable without a Web frontend. For the terminal TUI, keep interactions keyboard-first and text-readable:

- Do not rely on color alone; pair status with symbols/text.
- Provide a review step before applying plans.
- Preserve the CLI safety model: no direct filesystem mutation from a key press without a generated plan.

---

## Common Mistakes

- Do not add React components for the current CLI-only code path.
- Do not put scanning, install, or doctor logic inside components.
- Do not use browser-specific APIs in the planned Ink TUI.
- Do not bypass `buildInstallPlan()` / `buildUninstallPlan()` from UI actions.
