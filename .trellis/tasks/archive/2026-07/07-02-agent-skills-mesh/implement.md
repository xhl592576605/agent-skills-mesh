# Agent Skills Mesh Implementation Plan

## Execution Strategy

先实现 CLI 核心闭环，再实现 Source/Discover 完整能力，最后实现 TUI。不要在第一轮把 TUI 和仓库同步全部做完；优先验证扫描、索引、安装、卸载和 doctor 的核心模型。

## Phase 0. Project Skeleton

- [ ] 初始化 TypeScript + pnpm 项目。
- [ ] 添加 CLI 入口 `src/cli/index.ts`。
- [ ] 配置 `package.json` bin：`asm`。
- [ ] 配置 `tsconfig.json`、Vitest。
- [ ] 添加基础脚本：
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm lint`（如引入 lint）

Recommended dependencies:

```bash
pnpm add cac zod execa fs-extra gray-matter toml
pnpm add -D typescript tsx vitest @types/node
```

TUI dependencies can wait:

```bash
pnpm add ink react
```

## Phase 1. Config and Index Storage

Files:

```txt
src/core/models/config.ts
src/core/models/index.ts
src/core/storage/config-store.ts
src/core/storage/index-store.ts
src/utils/path.ts
src/utils/fs.ts
```

Tasks:

- [ ] Define `AppConfig`, `SourceConfig`, `AgentConfig`.
- [ ] Implement config path resolution and `~` expansion.
- [ ] Implement `createDefaultConfig()`.
- [ ] Implement config read/write.
- [ ] Implement `IndexFile` model.
- [ ] Implement atomic index write: write temp file then rename.
- [ ] Implement `asm init`.

Validation:

```bash
asm init
ls ~/.agent-skills-mesh
cat ~/.agent-skills-mesh/config.toml
cat ~/.agent-skills-mesh/index.json
```

## Phase 2. Skill Scanner and Refresh

Files:

```txt
src/core/models/skill.ts
src/core/scanners/skill-scanner.ts
src/core/services/refresh-service.ts
src/utils/hash.ts
```

Tasks:

- [ ] Implement source scanning for:
  - `path/SKILL.md`
  - `path/*/SKILL.md`
  - `path/skills/*/SKILL.md`
- [ ] Parse `SKILL.md` frontmatter with `gray-matter`.
- [ ] Compute hash, mtime, size.
- [ ] Group candidates by skill name.
- [ ] Merge candidates to `SkillRecord`.
- [ ] Implement conflict/discovered/managed status calculation.
- [ ] Implement `asm refresh`.
- [ ] Implement `asm skill list`.
- [ ] Implement `asm skill info <name>`.

Validation:

```bash
asm refresh
asm skill list
asm skill info frontend-design
```

Unit tests:

- [ ] Scans `skills/foo/SKILL.md`.
- [ ] Scans `foo/SKILL.md`.
- [ ] Scans single skill directory.
- [ ] Parses frontmatter name/description.
- [ ] Detects same-name multi-source conflict.

## Phase 3. Installation Detection and Symlink Install

Files:

```txt
src/core/models/agent.ts
src/core/models/installation.ts
src/core/models/install-plan.ts
src/core/services/install-service.ts
```

Tasks:

- [ ] Compute `targetPath = agent.skillsDir / skillName`.
- [ ] Detect installation status:
  - missing target → available
  - same symlink → installed
  - broken symlink → broken-link
  - symlink to unknown path → external
  - real directory with `SKILL.md` → external
  - real directory without `SKILL.md` → conflict
- [ ] Build install plan.
- [ ] Implement `asm install <skill> --agent <agent> --dry-run`.
- [ ] Implement symlink creation.
- [ ] Implement `asm uninstall <skill> --agent <agent>`.

Validation:

```bash
asm install frontend-design --agent pi --dry-run
asm install frontend-design --agent pi
asm install frontend-design --agent pi
asm uninstall frontend-design --agent pi
```

Unit tests:

- [ ] Creates symlink when target is missing.
- [ ] Skips existing same symlink.
- [ ] Conflicts on real directory.
- [ ] Detects broken symlink.
- [ ] Uninstall deletes symlink only.

## Phase 4. Doctor

Files:

```txt
src/core/services/doctor-service.ts
src/cli/commands/doctor.ts
```

Tasks:

- [ ] Check config exists.
- [ ] Check index exists.
- [ ] Check source path access.
- [ ] Check agent skills_dir exists / writable.
- [ ] Check broken symlinks.
- [ ] Check skill conflicts.
- [ ] Print human-readable summary.

Validation:

```bash
asm doctor
```

## Phase 5. Source and Single Skill Management

Files:

```txt
src/core/services/source-service.ts
src/core/services/skill-service.ts
src/utils/git.ts
src/cli/commands/source.ts
src/cli/commands/skill.ts
```

Tasks:

- [ ] `asm source list`
- [ ] `asm source add <path>`
- [ ] `asm source add-repo <git-url>` clone into `~/.agent-skills-mesh/repos/`
- [ ] `asm source sync [id]`
- [ ] `asm source enable/disable/remove <id>`
- [ ] `asm skill add <path>` as `single-skill`
- [ ] `asm skill import <path>` copy into local store
- [ ] `asm skill prefer <name> --source <source-id>`

Validation:

```bash
asm source add ~/.agents/skills
asm source list
asm skill add ~/Desktop/my-skill
asm skill import ~/Desktop/my-skill
asm skill prefer frontend-design --source my-skills
```

## Phase 6. Discover

Files:

```txt
src/core/services/discover-service.ts
src/cli/commands/discover.ts
```

Tasks:

- [ ] Scan `~/.agents/skills` and agent dirs for unmanaged real directories.
- [ ] Detect external symlinks.
- [ ] Detect broken symlinks.
- [ ] `asm discover` list discovered/external/broken/conflict.
- [ ] `asm adopt <skill>` mark as managed without moving.
- [ ] `asm ignore <skill>` suppress repeated prompts.

Validation:

```bash
asm discover
asm adopt my-new-skill
asm ignore old-skill
```

## Phase 7. TUI MVP

Files:

```txt
src/tui/App.tsx
src/tui/screens/MatrixScreen.tsx
src/tui/screens/DiscoverScreen.tsx
src/tui/screens/DoctorScreen.tsx
src/tui/components/Layout.tsx
src/tui/components/SkillInspector.tsx
src/tui/components/InstallPlanModal.tsx
```

Tasks:

- [ ] Implement `asm tui`.
- [ ] Matrix screen: Skill × Agent state table.
- [ ] Discover screen: discovered/external/broken/conflict list.
- [ ] Doctor screen: checks and suggested fixes.
- [ ] Use pending changes; do not directly mutate filesystem on key press.
- [ ] Generate install plan before applying.

Validation:

```bash
asm tui
```

## Required Validation Before Reporting Done

Run at least:

```bash
pnpm typecheck
pnpm test
asm init
asm refresh
asm skill list
asm doctor
```

If install behavior is implemented, also run against a temp home directory, not the real user home, unless explicitly approved:

```bash
ASM_HOME=/tmp/asm-test-home asm init
ASM_HOME=/tmp/asm-test-home asm refresh
ASM_HOME=/tmp/asm-test-home asm install frontend-design --agent pi --dry-run
```

## Rollback Points

- Before implementing symlink operations, ensure tests use temporary directories.
- Never run install tests against real `~/.pi/skills` or `~/.claude/skills` by default.
- If scanner/index model proves wrong, stop after Phase 2 and revise `prd.md`/`design.md` before continuing.
- If TUI state becomes complex, keep TUI read-only until CLI behavior is stable.

## Review Gate Before `task.py start`

- [ ] User reviews `prd.md`, `design.md`, and `implement.md`.
- [ ] User explicitly approves starting implementation.
- [ ] Relevant Trellis context manifests are curated.
- [ ] `task.py start 07-02-agent-skills-mesh` is run only after approval.
