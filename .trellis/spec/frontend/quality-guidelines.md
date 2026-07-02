# Quality Guidelines

> Code quality standards for frontend and future TUI development.

---

## Current State

There is no Web frontend and no implemented TUI. Frontend quality guidance therefore applies mainly as constraints for future Ink/React work and as a reminder not to weaken existing CLI/core guarantees.

Current verification commands from `package.json` are:

```bash
npm run typecheck
npm test
```

The project does not currently define a lint script.

---

## Forbidden Patterns

- Do not add browser frontend scaffolding for CLI/TUI work.
- Do not add React/Ink dependencies unless implementing actual TUI behavior.
- Do not put filesystem mutation logic in components, hooks, or UI state stores.
- Do not bypass core service plans for install/uninstall actions.
- Do not make tests depend on the user's real `~/.pi/agent/skills`, `~/.claude/skills`, `~/.codex/skills`, or `~/.agent-skills-mesh` directories.

---

## Required Patterns

Future TUI work must preserve current safety boundaries:

- Load config/index through `ConfigStore` and `IndexStore`.
- Use typed services from `src/core/services/**` for refresh, doctor, install, and uninstall behavior.
- Generate a pending plan before applying filesystem changes.
- Keep status displays derived from `IndexFile`, `InstallationRecord`, `IssueRecord`, and `DoctorCheck` data.
- Use terminal-safe text and symbols; do not rely on color alone.

Reference files:

- `src/core/services/install-service.ts` for plan/apply separation.
- `src/core/services/doctor-service.ts` for typed diagnostics.
- `tests/install-service.test.ts` for safe temp-dir filesystem tests.

---

## Testing Requirements

For current CLI/core changes that a future TUI would use, run:

```bash
npm run typecheck
npm test
```

For future TUI changes, add focused tests around the core/service interaction rather than only visual snapshots. At minimum, cover:

- Rendering or deriving matrix state from `IndexFile.installations`.
- Creating an install/uninstall plan before applying.
- Refusing conflicted plans.
- Doctor status display for `ok`, `warning`, and `error` checks.

---

## Code Review Checklist

- [ ] Does the change avoid inventing Web frontend structure where none exists?
- [ ] Does UI code reuse core models instead of duplicating them?
- [ ] Are filesystem mutations still routed through plan/apply services?
- [ ] Are tests isolated with temp directories or `ASM_HOME` when storage or symlinks are involved?
- [ ] Are terminal status indicators readable without color?
- [ ] Do `npm run typecheck` and `npm test` pass for touched code?
