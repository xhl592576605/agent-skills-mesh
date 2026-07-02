# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

Backend code in Agent Skills Mesh includes the CLI entrypoint, core services, scanners, storage, and filesystem operations. The main quality bar is safety: commands must be testable in temporary homes, filesystem writes must be explicit, and symlink operations must never overwrite or delete user-owned real directories.

---

## Scenario: CLI Storage and Symlink Safety Contracts

### 1. Scope / Trigger

- Trigger: Agent Skills Mesh introduced new CLI commands, `ASM_HOME` environment wiring, TOML/JSON storage, directory scanning, and symlink install/uninstall behavior.
- Applies to: `src/cli/**`, `src/core/storage/**`, `src/core/scanners/**`, `src/core/services/**`, and `src/utils/**`.
- Required because these commands can write to user directories such as `~/.agent-skills-mesh` and Agent skill directories.

### 2. Signatures

CLI command signatures that must remain safe by default:

```txt
asm init [--force]
asm refresh
asm skill list
asm skill info <name>
asm install <skill> --agent <agent> [--dry-run]
asm uninstall <skill> --agent <agent> [--dry-run]
asm doctor
```

Core service signatures should keep side effects explicit:

```ts
ConfigStore.init(options?: { force?: boolean }): Promise<AppConfig>
IndexStore.init(options?: { force?: boolean }): Promise<IndexFile>
refreshIndex(config: AppConfig, previous: IndexFile): Promise<IndexFile>
buildInstallPlan(config: AppConfig, index: IndexFile, skillName: string, agentId: string): Promise<InstallPlan>
applyInstallPlan(plan: InstallPlan): Promise<void>
buildUninstallPlan(config: AppConfig, skillName: string, agentId: string): Promise<UninstallPlan>
applyUninstallPlan(plan: UninstallPlan): Promise<void>
```

### 3. Contracts

- `ASM_HOME` overrides the default home path and must be honored by all storage commands.
- Default home is `~/.agent-skills-mesh` when `ASM_HOME` is not set.
- `asm init` must create `config.toml`, `index.json`, `state.json`, `repos/`, `local/`, and `cache/`.
- `asm init` must not overwrite an existing `config.toml` or `index.json` unless `--force` is explicitly passed.
- `index.json` writes must use a temp file + rename atomic write pattern.
- `asm install --dry-run` must only print the plan and must not create symlinks or directories beyond reads needed to build the plan.
- `asm install` may create a symlink only when the target path is missing or repair behavior is explicitly represented by the install plan.
- `asm uninstall` may delete only symlinks. It must not delete source skill directories, real directories, or regular files.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| `config.toml` missing for non-init command | Fail with guidance to run `asm init` |
| Existing config/index + `asm init` without `--force` | Preserve existing files |
| Existing config/index + `asm init --force` | Replace with default config/index |
| Skill has multiple candidates and no preference | Install plan has conflict; do not choose silently |
| Install target missing | Plan `create-symlink` |
| Install target is same symlink | Plan `skip` |
| Install target is different symlink | Plan `conflict` unless explicit future force behavior exists |
| Install target is real directory or file | Plan `conflict`; do not overwrite |
| Uninstall target is symlink | Remove the symlink only |
| Uninstall target is real directory or file | Plan conflict/refusal; do not delete |
| Broken symlink found | Report via refresh/doctor/install detection |

### 5. Good/Base/Bad Cases

- Good: tests and smoke tests set `ASM_HOME` to a temp directory and set Agent `skills_dir` values to temp directories before running install/uninstall.
- Base: `asm install foo --agent pi --dry-run` prints a plan and leaves `pi-skills/foo` absent.
- Bad: running install tests against real `~/.pi/skills`, or allowing `asm init` to replace a user's existing config without `--force`.

### 6. Tests Required

- Storage tests:
  - assert `init()` preserves existing config/index by default.
  - assert `init({ force: true })` overwrites existing config/index.
- Scanner tests:
  - assert `path/SKILL.md`, `path/*/SKILL.md`, and `path/skills/*/SKILL.md` are discovered.
  - assert frontmatter `name` and `description` are parsed.
  - assert same-name candidates become `conflict`.
- Install tests:
  - assert missing target creates symlink after applying plan.
  - assert same symlink is skipped.
  - assert real directory target conflicts.
  - assert broken symlink is detected.
  - assert uninstall deletes symlink only and source still exists.
- CLI smoke tests:
  - run against temporary `ASM_HOME` and temporary Agent `skills_dir` values only.

### 7. Wrong vs Correct

#### Wrong

```bash
# Dangerous: may mutate the developer's real Pi skills directory.
node dist/cli/index.js install foo --agent pi
```

#### Correct

```bash
TMP=$(mktemp -d)
export ASM_HOME="$TMP/asm-home"
# Write config.toml so all agent skills_dir values point inside $TMP.
node dist/cli/index.js install foo --agent pi --dry-run
node dist/cli/index.js install foo --agent pi
```

---

## Forbidden Patterns

- Do not silently overwrite user config, index files, existing skill directories, or existing non-matching symlinks.
- Do not delete real directories or source skill directories during uninstall.
- Do not run install/uninstall validation against real Agent directories unless the user explicitly asks for that exact mutation.
- Do not add filesystem writes to plan builders; plan builders should inspect and describe, while apply functions mutate.

---

## Required Patterns

- Support `ASM_HOME` in tests, smoke tests, and examples that mutate storage.
- Use temp directories for symlink install/uninstall tests.
- Prefer build-plan/apply-plan separation for any write operation.
- Use atomic writes for JSON index updates.
- Keep CLI output human-readable, but keep core services typed and testable independently from CLI formatting.

---

## Testing Requirements

Before reporting CLI storage or install work as done, run:

```bash
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/vitest run
```

When CLI behavior is touched, also run a smoke test with temporary `ASM_HOME` and temporary Agent skill directories. The smoke test should cover `init`, `refresh`, `skill list`, `skill info`, `install --dry-run`, `install`, repeated `install`, `uninstall`, and `doctor` when those commands are in scope.

---

## Code Review Checklist

- [ ] Does every command that can mutate files have a dry-run or plan phase when applicable?
- [ ] Are real directories and user-owned files protected from overwrite/delete?
- [ ] Does the code distinguish plan building from plan application?
- [ ] Are tests isolated with temp directories and `ASM_HOME`?
- [ ] Are config/index writes safe when files already exist?
- [ ] Are conflicts explicit instead of silently resolved?
