# Error Handling

> How errors are handled in this project.

---

## Overview

Agent Skills Mesh is currently a CLI-first TypeScript application. It does not expose HTTP APIs and does not define custom error classes. Errors are represented in three local ways:

1. Throw `Error` for command-stopping failures such as missing config, missing skill, unknown agent, or conflicting install plans.
2. Return typed status records for expected domain problems such as skill conflicts, broken symlinks, disabled agents, and doctor warnings.
3. Catch only known filesystem misses (`ENOENT`) when absence is an expected state.

Reference examples:

- `src/cli/index.ts` throws usage/domain errors for `skill info`, unknown skill subcommands, and missing `config.toml`.
- `src/core/services/install-service.ts` returns conflict actions from plan builders and throws only when applying a conflicted plan.
- `src/core/services/doctor-service.ts` returns `DoctorCheck[]` with `ok`, `warning`, and `error` statuses instead of throwing for health findings.
- `src/core/scanners/skill-scanner.ts` returns an empty candidate list when a source path is missing.
- `src/utils/fs.ts` treats `ENOENT` as `false` in `pathExists()` and rethrows other filesystem errors.

---

## Error Types

There are no custom error classes today. Use the existing local shapes:

- `Error` for unrecoverable CLI command failures.
- `InstallAction` with `type: "conflict"` for install/uninstall safety blockers (`src/core/models/install-plan.ts`).
- `InstallationRecord.status` for discovered installation states (`src/core/models/installation.ts`).
- `IssueRecord` for refresh-time warnings (`src/core/models/index.ts`).
- `DoctorCheck` for health-check output (`src/core/services/doctor-service.ts`).

Do not add custom error hierarchies unless the caller needs programmatic branching that cannot be represented by the existing typed statuses.

---

## Propagation Patterns

- Let unexpected filesystem and parsing errors bubble to the CLI. Examples: `fs.readFile()` in `ConfigStore.read()` and JSON parse errors in `IndexStore.read()` are not hidden.
- Convert expected absence into values. Examples: missing scan roots return `[]`; missing install targets become `available` or `create-symlink` actions.
- Convert user-safety blockers into conflicts before mutation. `buildInstallPlan()` and `buildUninstallPlan()` should describe conflicts; `applyInstallPlan()` / `applyUninstallPlan()` should refuse conflicted plans.
- Keep plan builders side-effect-light. They may inspect the filesystem, but they should not create or delete skill directories.

---

## CLI Error Surface

The CLI uses `cac` and plain console output. There is no global error formatter in `src/cli/index.ts` today. Existing command output is human-readable:

- `loadStores()` throws `config.toml not found. Run \`asm init\` first.` for non-init commands before config exists.
- `skill info` throws `Skill not found: <name>` when the index has no record.
- `install` and `uninstall` print the plan first; applying a conflicted plan throws `Install plan has conflicts` or `Uninstall plan has conflicts`.
- `doctor` prints status symbols and sets `process.exitCode = 1` only when an error check exists.

There are no API error responses because the project has no server or HTTP layer.

---

## Filesystem Error Handling

Use the established helper behavior:

- Use `pathExists()` from `src/utils/fs.ts` when missing paths are normal.
- Use local `safeLstat()` pattern from `src/core/services/install-service.ts` when the caller needs file type information and treats `ENOENT` as absence.
- Rethrow non-`ENOENT` errors so permission problems and malformed states are visible.
- Do not catch broad errors and continue with partial writes.

---

## Common Mistakes

- Do not hide install conflicts by auto-overwriting real directories or non-matching symlinks.
- Do not log-and-continue after failed writes to config, index, or symlink targets.
- Do not turn doctor warnings into thrown exceptions; doctor is a diagnostic report.
- Do not add HTTP-style response objects to core services; there is no backend API layer.
- Do not catch all errors in the CLI unless a clear, tested user-facing error format is added.
