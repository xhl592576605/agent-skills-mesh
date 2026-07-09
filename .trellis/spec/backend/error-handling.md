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

---

## i18n Error Codes (Programmatic Branching Exception)

The "no custom error hierarchies" rule has one documented exception: **i18n**. When the UI must translate a command-stopping failure by error type, it needs programmatic branching that existing typed statuses cannot provide (typed statuses cover expected domain states — `InstallAction` conflict, `DoctorCheck`, `InstallationRecord.status`; command-stopping `throw` failures have no status).

Pattern (`src/core/errors.ts`):

- `ErrorCode` — string union of business error codes, one per command-stopping `throw` failure that needs locale-aware translation. Source of truth is the `ErrorCode` union in `src/core/errors.ts`; dictionary keys `err.<CODE>` mirror it 1:1. Current codes, grouped by the service that throws them:
  - install/repair (`install-service.ts`): `SKILL_NOT_FOUND`, `AGENT_NOT_FOUND`, `NO_INSTALLABLE_CANDIDATE`, `INSTALL_PLAN_CONFLICT`, `UNINSTALL_PLAN_CONFLICT`, `REPAIR_PLAN_CONFLICT`, `REPAIR_TARGET_MISSING`, `REPAIR_TARGET_NOT_SYMLINK`
  - source-service: `SOURCE_PATH_NOT_EXIST`, `SOURCE_PATH_NOT_DIRECTORY`, `SOURCE_ALREADY_REGISTERED`, `SOURCE_NOT_SKILL_DIR`, `GIT_REPO_ALREADY_REGISTERED`, `REPO_TARGET_EXISTS`, `PURGE_REFUSED_NOT_UNDER_REPOS`, `SOURCE_ID_EXISTS`, `SOURCE_ID_UNKNOWN`
  - skill-service: `SKILL_ALREADY_INSTALLED`, `SKILL_NOT_IN_INDEX`, `SKILL_NO_CANDIDATE`, `SKILL_MULTIPLE_CANDIDATES`, `SKILL_NOT_INSTALLED`, `SOURCE_NOT_PROVIDE_SKILL`, `CANDIDATE_NOT_CONFIGURED_SOURCE`
  - agent-service: `AGENT_ID_INVALID`, `AGENT_ALREADY_EXISTS`, `AGENT_BUILTIN_NO_REMOVE` (`AGENT_NOT_FOUND` is reused from install/repair)
  - ssot/config (`ssot-service.ts`, `config-store.ts`): `SOURCE_NOT_FOUND`, `COPIED_SKILL_INVALID`, `SSOT_TARGET_NOT_DIRECTORY`, `SSOT_TARGET_EXISTS`, `INVALID_TOML`, `CONFIG_NOT_FOUND`
  - safe-path (`utils/safe-path.ts`): `INVALID_SKILL_NAME` (cross-platform skill name validation — Windows-forbidden chars + reserved names)
- `bizError(code, params, message?)` — returns a **plain `Error` instance** with附加 `code` / `params` properties. **Not a subclass** — stays within the "no hierarchy" rule字面 while enabling UI translation branching. `message` is the English fallback for logs / non-i18n contexts.
- `isBizError(e)` — duck-type guard (`e instanceof Error && typeof e.code === "string"`).

Contract:

- Core throws `bizError(CODE, params, englishFallback)`. UI (`src/i18n/formatError`) translates `err.${code}` via the dictionary with `params` interpolation; non-biz errors get `err.systemPrefix` + the original message.
- Dictionary keys `err.<CODE>` correspond 1:1 to `ErrorCode`. Adding a code requires updating both `en.ts` and `zh-CN.ts` (字典完整性 test enforces).
- `src/i18n/` does **not** import `src/core/errors.ts` (duck-type detection), keeping the i18n module independently testable.

Extend only when a command-stopping `throw` failure needs locale-aware translation. Expected domain problems continue using typed statuses, not error codes.
