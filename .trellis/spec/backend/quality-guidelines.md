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
asm skill enable <name> --agent <agent>
asm skill disable <name> --agent <agent>
asm doctor
```

Core service signatures should keep side effects explicit:

```ts
ConfigStore.init(options?: { force?: boolean }): Promise<AppConfig>
IndexStore.init(options?: { force?: boolean }): Promise<IndexFile>
refreshIndex(config: AppConfig, state?: StateFile): Promise<IndexFile>
buildInstallPlan(config: AppConfig, index: IndexFile, skillName: string, agentId: string, state?: StateFile): Promise<InstallPlan>
applyInstallPlan(plan: InstallPlan, stateStore?: StateStore): Promise<void>
buildUninstallPlan(config: AppConfig, skillName: string, agentId: string, state?: StateFile): Promise<UninstallPlan>
applyUninstallPlan(plan: UninstallPlan, stateStore?: StateStore): Promise<void>
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
- Bad: running install tests against real `~/.pi/agent/skills`, or allowing `asm init` to replace a user's existing config without `--force`.

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

## Scenario: Three-Layer Command Model (Source / Skill / Agent)

> **Migrated (`07-03-cli-command-redesign`)**: ASM CLI reorganized into three layers — `source add/update/remove/list/enable/disable`, `skill search/add/list/info/update/remove/rebind/enable/disable` (commander nested subcommands). Old top-level commands (`install`/`uninstall`/`add-repo`/`sync`/`discover`/`adopt`/`ignore`/`prefer`/`import`) and `[skill-overrides]` config removed; `index.json` slimmed (no `sources` mirror / override-derived fields; `SkillStatus` adds `orphan`). Storage split: `config.toml`=intent, `state.json`=SSOT truth, `index.json`=rebuildable cache. Two-step update: `source update` only reports updatable; `skill update` explicitly replaces SSOT. The signatures/contracts below are **legacy** and partially superseded — see the task `design.md` command tree and `src/cli/index.ts` + service files for the current truth until the next full spec sync.

### 1. Scope / Trigger

- Trigger: Agent Skills Mesh added dynamic source management, git repository sync, single-skill import/prefer, discover, adopt, ignore, and unignore commands.
- Applies to: `src/cli/index.ts`, `src/core/services/source-service.ts`, `src/core/services/skill-service.ts`, `src/core/services/discover-service.ts`, `src/core/services/refresh-service.ts`, `src/core/storage/config-store.ts`, and `src/utils/git.ts`.
- Required because these commands mutate user-owned directories, cloned repositories, `config.toml`, `index.json`, and Agent skill directories.

### 2. Signatures

CLI command signatures:

```txt
asm source list
asm source add <path> [--id <id>]
asm source add-repo <git-url> [--id <id>] [--branch <branch>]
asm source sync [id]
asm source remove <id> [--purge]
asm source enable <id>
asm source disable <id>
asm skill add <path> [--id <id>]
asm skill import <path> [--id <id>]
asm skill prefer <name> --source <source-id>
asm discover
asm adopt <skill>
asm ignore <skill>
asm unignore <skill>
```

Core service signatures:

```ts
ConfigStore.write(config: AppConfig): Promise<void>
addSource(configStore: ConfigStore, dirPath: string, options?: { id?: string }): Promise<SourceConfig>
addRepoSource(configStore: ConfigStore, gitUrl: string, options?: { id?: string; branch?: string }): Promise<SourceConfig>
syncSources(configStore: ConfigStore, sourceId?: string): Promise<SyncResult[]>
removeSource(configStore: ConfigStore, id: string, options?: { purge?: boolean }): Promise<void>
setSourceEnabled(configStore: ConfigStore, id: string, enabled: boolean): Promise<void>
addSingleSkill(configStore: ConfigStore, dirPath: string, options?: { id?: string }): Promise<SourceConfig>
importSkill(configStore: ConfigStore, dirPath: string, options?: { id?: string }): Promise<SourceConfig>
preferSkill(configStore: ConfigStore, indexStore: IndexStore, skillName: string, sourceId: string): Promise<void>
listDiscover(index: IndexFile): DiscoverEntry[]
adoptSkill(configStore: ConfigStore, indexStore: IndexStore, skillName: string): Promise<AdoptResult>
setIgnored(configStore: ConfigStore, indexStore: IndexStore, skillName: string, ignored: boolean): Promise<void>
```

### 3. Contracts

- User intent for `prefer`, `ignore`, and `adopt` lives in `config.toml` under `[skill-overrides.<name>]`; `index.json` is a fact snapshot only.
- `refreshIndex()` must merge `config.skillOverrides` into `SkillRecord` status and preferred fields. It must not preserve intent by copying fields from the previous index.
- `ConfigStore.write()` must be atomic (temp file + rename), same as index writes.
- Git operations must call the system `git` through Node's built-in `node:child_process` (`execFile`/promisified `execFile`). Do not add `execa`, `isomorphic-git`, or other git libraries for this project.
- `source add-repo` must clone successfully before writing config. If clone fails, config must remain unchanged and partial clone directories must be cleaned up best-effort.
- `source sync` must use `git pull --ff-only` for existing repositories. It must report non-fast-forward conflicts and never rebase, stash, merge, or force automatically.
- `source remove` must not delete cloned repository directories unless `--purge` is explicitly passed, and purge must refuse paths outside the configured repos directory.
- `skill import` must copy the complete directory including `SKILL.md`; if config write fails after copying, the copied directory must be cleaned up best-effort.
- `skill prefer` must validate that the source exists and actually provides the requested skill candidate before writing `preferredSourceId`.
- `adopt` is physical takeover: move the discovered real directory to the configured global source (`~/.agents/skills` by default), create a symlink at the original Agent path pointing to the new source path, write `managed = true`, and refresh the index.
- `adopt` must not overwrite an existing global source directory. If the skill is already physically inside the global source, adopt only writes `managed = true` and refreshes.
- Agent skill directories are treated as symlink zones. Real directories there are discoverable external work; symlinks there are installation artifacts and must not become scan candidates.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| Duplicate source path or git URL | Refuse or skip without adding a duplicate source |
| Custom source id already exists | Error; do not mutate config |
| Local source path is a regular file | Error; do not add source |
| `add-repo` clone fails | Clean partial clone best-effort; do not write config |
| `sync` sees non-fast-forward pull | Return failed sync result; do not rebase/stash/force |
| `remove --purge` target is outside repos dir | Refuse purge |
| `skill prefer` source does not provide candidate | Error; do not write override |
| `adopt` target already exists in global source | Error; do not overwrite |
| `adopt` discovered candidate is symlink or file | Error; only real directories can be adopted |
| `adopt` has multiple discovered candidates | Error in MVP; require manual resolution first |
| `ignore` unknown skill | Error; avoid hiding typos |
| `unignore` removes the last override field | Delete the empty override entry |

### 5. Good/Base/Bad Cases

- Good: `asm adopt foo` moves `tmp/pi-skills/foo` to `tmp/global-skills/foo`, creates `tmp/pi-skills/foo -> tmp/global-skills/foo`, writes `[skill-overrides.foo] managed = true`, and refreshes status to `managed`.
- Base: `asm source add-repo <local-test-repo>` clones into a temporary `ASM_HOME/repos/<id>` and registers a `git-repo` source only after clone succeeds.
- Bad: copying a discovered skill into the global source while leaving the original real directory in the Agent directory, causing duplicate candidates and conflicts.
- Bad: using real `~/.agents/skills` or `~/.pi/agent/skills` in tests or smoke tests.

### 6. Tests Required

- Config override tests:
  - round-trip `[skill-overrides.<name>]` through `ConfigStore.write()` and `ConfigStore.read()`.
  - assert invalid override names are rejected before writing unreadable TOML.
  - assert `managed`, `ignored`, and `preferredSourceId` affect refresh status.
- Source tests:
  - add/list local sources; reject duplicate paths and regular files.
  - add-repo clone success/failure with local git repositories only.
  - sync clone/pull; non-fast-forward must be reported as failure.
  - enable/disable/remove/purge paths with temp repos only.
- Skill tests:
  - add single-skill; import copies `SKILL.md`; prefer writes config override only after validating candidates.
- Discover tests:
  - list discovered/conflict/external/broken-link; exclude ignored skills.
  - adopt moves real directory, creates symlink, writes managed override, and refreshes status.
  - adopt refuses existing targets and multi-candidate discovered skills.
  - ignore/unignore update config and refresh index.
- CLI smoke tests:
  - run `init`, `source list`, `skill add` or `source add`, `refresh`, `discover`, `adopt`, `skill info`, `ignore`, and `unignore` under temporary `ASM_HOME` and temporary Agent directories only.

### 7. Wrong vs Correct

#### Wrong

```ts
// Wrong: writes user intent into index.json and lets the next refresh decide whether it survives.
index.skills[skillName].ignored = true;
await indexStore.write(index);
```

#### Correct

```ts
// Correct: user intent lives in config.toml; refresh derives index facts from it.
config.skillOverrides[skillName] = { ...config.skillOverrides[skillName], ignored: true };
await configStore.write(config);
const next = await refreshIndex(config, index);
await indexStore.write(next);
```

#### Wrong

```ts
// Wrong: copy adopt leaves a second real directory in the Agent directory.
await fs.cp(agentSkillDir, globalSkillDir, { recursive: true });
```

#### Correct

```ts
// Correct: move the real directory, then make the original Agent path a symlink installation artifact.
await fs.rename(agentSkillDir, globalSkillDir);
await fs.symlink(globalSkillDir, agentSkillDir, "dir");
```

---

## Scenario: SSOT Installed Skill Management

### 1. Scope / Trigger

- Trigger: Agent Skills Mesh uses a strict SSOT installed-store model for managed skills.
- Applies to: `src/core/models/state.ts`, `src/core/storage/state-store.ts`, `src/core/services/install-service.ts`, `src/core/services/ssot-service.ts`, `src/core/services/source-service.ts`, `src/core/services/discover-service.ts`, `src/core/services/skill-service.ts`, `src/core/scanners/skill-scanner.ts`, and CLI/TUI callers.
- Required because install, import, adopt, uninstall, and source sync can write to ASM home and user-configured Agent skill directories.

### 2. Signatures

Core service signatures must keep state explicit:

```ts
refreshIndex(config: AppConfig, state?: StateFile): Promise<IndexFile>
buildInstallPlan(config: AppConfig, index: IndexFile, skillName: string, agentId: string, state?: StateFile): Promise<InstallPlan>
applyInstallPlan(plan: InstallPlan, stateStore?: StateStore): Promise<void>
buildUninstallPlan(config: AppConfig, skillName: string, agentId: string, state?: StateFile): Promise<UninstallPlan>
applyUninstallPlan(plan: UninstallPlan, stateStore?: StateStore): Promise<void>
sourceUpdate(configStore: ConfigStore, stateStore: StateStore, sourceId?: string): Promise<SourceUpdateReport[]>   // two-step: reports updatable, does NOT touch SSOT
skillUpdate(configStore: ConfigStore, stateStore: StateStore, target: string): Promise<SkillUpdateReport[]>   // target = name | "--all"; explicitly replaces SSOT; fails for orphan
skillAdd(configStore: ConfigStore, stateStore: StateStore, index: IndexFile, name: string, options?: { source?: string }): Promise<InstalledSkillRecord>
skillRebind(configStore: ConfigStore, stateStore: StateStore, index: IndexFile, name: string, sourceId: string): Promise<void>
skillRemove(configStore: ConfigStore, stateStore: StateStore, name: string): Promise<void>
```

Install actions must distinguish side effects explicitly:

```ts
{ type: "copy-to-ssot"; sourcePath: string; targetPath: string; replace: boolean }
{ type: "create-symlink"; agentId: string; targetPath: string; linkTarget: string }
{ type: "remove-symlink"; agentId: string; targetPath: string }
{ type: "update-state"; record: InstalledSkillRecord; agentId?: string; removeAgentId?: string }
```

### 3. Contracts

- ASM-managed installed skill contents live under `config.paths.skills` (default `~/.agent-skills-mesh/skills`).
- Configured sources (`local-dir`, `single-skill`, `git-repo`) are discovery/update inputs only; the SSOT installed store is not a normal discover source.
- Agent skill directories are symlink-only distribution zones for ASM-managed skills. Managed symlinks must point to the SSOT path, not a source repo or local candidate path.
- `state.json` is the source of installed-state truth: `ssotPath`, source metadata, `contentHash`, timestamps, and `enabledAgents`.
- `config.toml` remains user intent; `index.json` remains generated scan facts. Do not persist installed-state truth in config or index.
- Skill names used for filesystem paths must pass `assertSafeSkillName`: no path separators, whitespace, control/format characters, `.` or `..`.
- Any state-derived or user-derived filesystem target must pass containment checks before writing:
  - SSOT paths stay inside `config.paths.skills`.
  - Agent target paths equal the configured agent `skills_dir/<skillName>`.
  - Source sync relative paths stay inside the configured source root.

### 4. Validation & Error Matrix

| Condition | Required behavior |
|---|---|
| `SKILL.md` frontmatter `name` contains `/`, `\\`, whitespace, control/format characters, `.` or `..` | Reject before creating candidates, state records, SSOT directories, or symlinks |
| SSOT target exists but no installed state record exists | Install plan is conflict; do not overwrite |
| Install target is missing | Copy candidate to SSOT, create symlink to SSOT, update state |
| Install target is same SSOT symlink | Skip symlink creation and keep/update state |
| Install target is different symlink, real directory, or file | Plan conflict; do not overwrite |
| Second agent installs same skill | Reuse existing SSOT content; create only the second agent symlink and update `enabledAgents` |
| Uninstall managed skill for one agent | Remove only that agent symlink and remove that `enabledAgents` entry; keep SSOT content |
| `source sync` fast-forwards and installed source hash changed | Safely replace SSOT content, update state hash/timestamps, repair enabled SSOT symlinks |
| `source sync` is non-fast-forward or pull fails | Do not touch SSOT content or installed state |
| State record contains SSOT path outside `config.paths.skills` | Report conflict/error; do not copy or symlink |
| State record contains unknown agent or mismatched target path | Report conflict; do not create arbitrary symlinks |
| Agent real skill directory is adopted | Move real directory into SSOT, replace original path with symlink to SSOT, write installed state |

### 5. Good/Base/Bad Cases

- Good: `asm install foo --agent pi` copies `source/foo` to `$ASM_HOME/skills/foo`, creates `pi-skills/foo -> $ASM_HOME/skills/foo`, and records `enabledAgents.pi` in `state.json`.
- Base: `asm uninstall foo --agent pi` removes only `pi-skills/foo`; `$ASM_HOME/skills/foo` remains for other agents or future re-enable.
- Bad: `pi-skills/foo -> $ASM_HOME/repos/repo/foo`, because the agent view now points to a source candidate instead of the SSOT installed store.
- Bad: accepting `name: ../escape` from frontmatter and using it in `path.join(config.paths.skills, skillName)`.

### 6. Tests Required

- State-store round-trip for `InstalledSkillRecord` and `enabledAgents`.
- Install tests for SSOT copy, symlink target, repeated install skip, second agent reuse, real-dir conflicts, and stale SSOT-without-state conflict.
- Uninstall tests asserting `remove-symlink` action and SSOT content preservation.
- Source sync tests for fast-forward update, `.claude-plugin` hash changes, non-fast-forward no-op, and per-skill conflict isolation.
- Scanner/import/install tests rejecting unsafe skill names and path traversal.
- Refresh tests asserting the SSOT installed store is not surfaced as a normal candidate and state-installed skills remain visible when source candidates are missing.
- CLI smoke tests must set temporary `ASM_HOME` and all enabled Agent `skills_dir` values to temporary directories.

### 7. Wrong vs Correct

#### Wrong

```ts
const ssotPath = path.join(config.paths.skills, skillName);
await fs.symlink(candidate.path, agentTarget, "dir");
```

#### Correct

```ts
const ssotPath = getSsotSkillPath(config, skillName); // validates name + containment
await copySkillDirToSsot(candidate.path, ssotPath, { replace: false });
await fs.symlink(ssotPath, safeJoin(agentSkillsDir, skillName, "agent skill path"), "dir");
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
