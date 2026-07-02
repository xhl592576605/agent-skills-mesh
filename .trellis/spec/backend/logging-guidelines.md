# Logging Guidelines

> How logging and command output are done in this project.

---

## Overview

Agent Skills Mesh currently has no logging library and no structured application logger. The production interface is a human-readable CLI in `src/cli/index.ts` that writes command results to stdout with `console.log()`.

Existing output patterns:

- `asm init` prints `Initialized <home>`.
- `asm refresh` prints how many skills and sources were indexed.
- `asm skill list` prints tab-separated `name`, `status`, and description rows.
- `asm skill info` prints labeled sections for candidates and installations.
- `asm install` / `asm uninstall` print a plan before applying changes.
- `asm doctor` prints symbol-prefixed checks and sets a non-zero exit code for error checks.

Reference files:

- `src/cli/index.ts` contains all current user-facing output.
- `src/core/services/doctor-service.ts` returns typed check data and leaves formatting to the CLI.
- `src/core/services/install-service.ts` returns plan actions and leaves formatting to `printPlan()`.

---

## Output vs Logging

Keep the current boundary:

- CLI layer formats text for humans.
- Core services return typed data and should not call `console.log()`.
- Storage, scanners, and utilities should not print during normal operation.
- Tests should assert typed return values where possible, not console strings.

This keeps service behavior reusable for the future TUI and avoids coupling domain logic to terminal formatting.

---

## Levels

No formal log levels exist. Use these current equivalents:

- Success/info: normal `console.log()` in CLI commands, such as `Initialized`, `Refreshed`, `Install applied`, and `Uninstall applied`.
- Warning: `DoctorCheck.status === "warning"`, printed with `!` by `symbol()` in `src/cli/index.ts`.
- Error: `DoctorCheck.status === "error"`, printed with `✗`; command-stopping failures throw `Error`.

Do not add debug output to core paths unless it is behind a deliberate CLI option or logger design.

---

## Structured Logging

There is no structured log format. The closest structured layer is the typed data returned by services:

- `DoctorCheck` objects: `{ status, kind, message }`.
- `InstallPlan` and `InstallAction` objects: actions with `type`, `agentId`, `targetPath`, `reason`, and `linkTarget`.
- `IssueRecord` objects in `index.json`: `severity`, `kind`, `message`, and optional `ref`.

When adding a new command, prefer adding typed service output first and formatting it in the CLI. Do not serialize arbitrary debug objects directly to stdout for normal users.

---

## What to Print

Print only information that helps the user understand command results:

- What was initialized or refreshed.
- Which skills were found and their status.
- Install/uninstall plan actions before mutation.
- Doctor check status and messages.
- Clear next-step guidance when config is missing, following `loadStores()` in `src/cli/index.ts`.

---

## What Not to Print

- Do not print full config contents by default; config may include local paths and future source URLs.
- Do not print environment variables wholesale.
- Do not print stack traces from core services as normal output.
- Do not print from scanners for every file visited; this would make `refresh` noisy.
- Do not print secrets if future Git or remote source credentials are added.

---

## Future Logger Constraints

If a logger is introduced later:

- Keep CLI human output stable unless intentionally changing command UX.
- Keep core services logger-optional so tests and future TUI can remain quiet.
- Ensure JSON/structured logs go to stderr or an explicit file, not mixed into stdout command tables by default.
- Add tests for any machine-readable output mode before depending on it.
