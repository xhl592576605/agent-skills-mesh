# Database Guidelines

> Database and persistence patterns for this project.

---

## Current State

No database layer currently exists in Agent Skills Mesh. The project is a Node.js TypeScript CLI that persists small local state files under the ASM home directory rather than using an ORM, SQL database, migrations, or a server-side data store.

Current persistence files are:

- `config.toml` managed by `src/core/storage/config-store.ts`.
- `index.json` managed by `src/core/storage/index-store.ts`.
- `state.json` managed by `src/core/storage/state-store.ts` and initialized by `ConfigStore.init()`.

Reference examples:

- `src/core/storage/config-store.ts` serializes and parses the user-editable TOML config.
- `src/core/storage/index-store.ts` reads and writes the generated JSON index.
- `src/utils/fs.ts` provides `atomicWriteFile()` for safe JSON writes.
- `tests/storage.test.ts` verifies init does not overwrite user config/index unless `force` is passed.

---

## Persistence Boundaries

- Treat `config.toml` as user intent: sources, agents, settings, and paths.
- Treat `index.json` as generated scan state: sources snapshot, skills, installations, and issues.
- Treat `state.json` as installed-state truth: installed skill source metadata, SSOT path, content hash, timestamps, and enabled agent symlink records.
- Do not add ad-hoc persistence from CLI handlers. Add storage behavior under `src/core/storage/**` and keep callers typed.
- Resolve `~/.agent-skills-mesh` through `resolveConfiguredPath()` / `getAsmHome()` in `src/utils/path.ts`; this preserves `ASM_HOME` override behavior.

---

## Query Patterns

There are no database queries. Current read patterns are file-based:

- `ConfigStore.read()` reads and parses the whole TOML file.
- `IndexStore.read()` reads and parses the whole JSON index, returning `createEmptyIndex()` if the file is missing.
- `StateStore.read()` reads and parses the installed state JSON, returning `createEmptyState()` if the file is missing.
- Services receive typed `AppConfig`, `IndexFile`, and `StateFile` objects rather than reaching into storage directly.

Follow the service boundary shown by:

- `src/cli/index.ts` `loadStores()` reads stores once and passes typed objects to services.
- `src/core/services/refresh-service.ts` derives the next `IndexFile` from config, previous index, state, scanners, and installation detection.
- `src/core/services/install-service.ts` builds install/uninstall plans from typed config/index/state input.

---

## Migrations

No migration framework exists. Both persisted formats currently have `version: 1`:

- `AppConfig.version` in `src/core/models/config.ts`.
- `IndexFile.version` in `src/core/models/index.ts`.

If a future schema change is introduced:

1. Add explicit versioned migration logic in the relevant store file.
2. Keep backward-compatible reads where practical.
3. Add tests under `tests/storage.test.ts` or a dedicated storage test file.
4. Preserve user-authored `config.toml` comments only if the serializer/parser is deliberately changed to support that; the current serializer rewrites known fields.

---

## Naming Conventions

Current persisted field names are stable and should match model names:

- Config uses snake_case for TOML settings that users edit, such as `install_strategy`, `default_agent`, `auto_refresh_on_start`, and `skills_dir` (`src/core/storage/config-store.ts`).
- TypeScript interfaces use the same names where they mirror persisted config (`src/core/models/config.ts`).
- Index records use camelCase JSON fields such as `updatedAt`, `preferredCandidateId`, and `expectedLinkTarget` (`src/core/models/index.ts`, `src/core/models/skill.ts`, `src/core/models/installation.ts`).

Avoid silently renaming persisted fields without a migration path.

---

## If a Real Database Is Added Later

A future database layer must not bypass current safety contracts:

- Preserve `ASM_HOME` isolation for tests and local runs.
- Keep filesystem mutation plans explicit before applying symlink changes.
- Keep generated scan facts separate from user intent.
- Add a storage adapter under `src/core/storage/**` rather than introducing database access in `src/cli/**`.
- Include migration tests and a rollback story for local user data.

---

## Common Mistakes

- Do not introduce an ORM or migration system just to manage the current small JSON/TOML files.
- Do not write directly to `index.json` with `fs.writeFile`; use the atomic write pattern from `IndexStore.write()` / `atomicWriteFile()`.
- Do not read or write the user's real home in tests; pass a temporary home to `ConfigStore` / `IndexStore` or set `ASM_HOME`.
- Do not store scan results in `config.toml`; generated facts belong in `index.json`.
