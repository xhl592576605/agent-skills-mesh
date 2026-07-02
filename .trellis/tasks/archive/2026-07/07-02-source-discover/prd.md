# Source 管理与 Discover

## Goal

在已完成的 CLI 核心闭环（init / refresh / skill list|info / install / uninstall / doctor）基础上，补齐 **Source 管理（Phase 5）** 与 **外部 Skill 发现（Phase 6）** 两块能力，让用户能够动态管理 skill 来源、从 Git 仓库同步 skills，并把在 Agent 目录或 `~/.agents/skills` 中手动创建的 skill 纳入管理。

本任务覆盖归档任务 `07-02-agent-skills-mesh` 的 `implement.md` Phase 5 与 Phase 6，作为同一开发批次（M1 → M2）交付。

## Background

当前状态：

- `SourceConfig` 模型已定义（`src/core/models/config.ts`），`config.toml` 的 `[[sources]]` 读写与序列化已实现。
- `asm init` 写死的默认 source 只有 `global-agents-skills`，用户无法通过 CLI 动态 `add / remove / enable / disable`。
- 没有 Git 仓库支持：无法 `add-repo <git-url>`、无法 `sync` clone/pull。
- `refreshIndex` 已经会把 config.sources + 所有 agent 的 `skills_dir` 作为 source 扫描，外部创建的 skill 已被索引为 `discovered` 状态；但没有 `discover` 命令来过滤展示，也没有 `adopt`/`ignore` 操作。
- `SkillRecord.preferredSourceId` / `ignored` 字段已存在，`refreshIndex.mergeCandidates` 已会从 previous index 保留这两个值，但没有写入入口。

缺口一句话：**配置层缺动态 source 管理 + git 同步；索引层缺 prefer/ignore/adopt 写入入口；CLI 缺 source / skill / discover 子命令树。**

## Product Scope

### In Scope

**Source 管理（M1）：**

- `asm source list`：列出所有 source（id / name / type / enabled / path / url）。
- `asm source add <path>`：把本地目录注册为 `local-dir` source。
- `asm source add-repo <git-url>`：clone 到 `~/.agent-skills-mesh/repos/`，注册为 `git-repo` source。
- `asm source sync [id]`：无 id 时同步所有 `git-repo`；新仓库 clone、已有仓库 pull。
- `asm source remove <id>`：从 config 移除 source（不删除已 clone 的仓库文件，除非显式选项）。
- `asm source enable <id>` / `asm source disable <id>`：切换 source enabled。
- `asm skill add <path>`：把单个 skill 目录注册为 `single-skill` source。
- `asm skill import <path>`：复制到 `~/.agent-skills-mesh/local/<name>/` 并注册。
- `asm skill prefer <name> --source <source-id>`：为同名多来源 skill 设置 preferred source。

**Discover（M2）：**

- `asm discover`：列出 `discovered` / `external` / `broken-link` / `conflict` 状态的项（来自 index，不重新扫描）。
- `asm adopt <skill>`：把 `discovered` skill 原地纳入管理（不移动文件）。
- `asm ignore <skill>`：把 skill 标记为 ignored，后续 refresh/discover 不再提示。
- `asm unignore <skill>`：取消 ignore。

### Out of Scope

- TUI（Phase 7，单独任务）。
- `asm skill search <keyword>`（可后置，list/info 已够 MVP）。
- `--force` 覆盖真实目录安装（已明确 MVP 不做）。
- 仓库 sync 的复杂冲突解决（rebase / stash / force）。
- SQLite 索引迁移。
- Windows 兼容。

## Requirements

### R1. Config 持久化扩展 + 意图层

- `ConfigStore` 必须支持整体 `write(config)`，原子写（tmp + rename），序列化格式与现有 `serializeConfig` 一致、可回读。
- 所有 source 增删改查操作必须落到 `config.toml`（用户意图层），不能只改内存。
- **意图层迁移（方案 B）**：`prefer` / `ignore` / `adopt` 的用户意图持久化到 `config.toml` 新增的 `[skill-overrides.<name>]` 表（字段 `ignored` / `managed` / `preferredSourceId` / `preferredCandidateId`），不再存 `index.json`。`index.json` 回归纯事实层。
- `refresh` 从 `config.skillOverrides` 读取意图合并到 `SkillRecord`，而非从 previous index 抄回。

### R2. Source 生命周期

- `add` / `add-repo` / `skill add` / `skill import` 必须生成**稳定、可引用**的 source id。
- 重复添加相同 path/url 时应 skip 并提示，不能产生重复 source。
- `add-repo` 必须先 clone 成功再注册 source；clone 失败不写 config。
- `remove` 默认不删除 `repos/` 下的已 clone 目录；需显式选项才删除。
- `enable`/`disable`/`remove` 对不存在的 id 报错。

### R3. Git 同步

- `sync` 无参数：遍历所有 enabled `git-repo` source。
- 新仓库（`repos/` 下不存在）执行 `git clone`。
- 已有仓库执行 `git pull --ff-only`；非快进失败时报告冲突，**不自动 rebase/stash/force**。
- sync 完成后应触发一次 `refresh`（或提示用户手动 refresh）。

### R4. Skill prefer / import

- `skill prefer <name> --source <id>` 必须校验：source id 存在、该 source 确实提供了该 skill 的 candidate；否则报错。
- prefer 写入 `config.toml` 的 `[skill-overrides.<name>]`，后续 `install` / `refresh` 默认使用该 preferred source，status 从 `conflict` 变 `managed`。
- `skill import` 复制后注册为 `single-skill` source，复制必须是完整目录拷贝（含 `SKILL.md`）。

### R5. Discover 展示与操作

- `discover` 必须区分并清晰展示四类：`discovered`（外部真实目录）、`external`（安装层：目标是指向未知位置的 symlink 或含 SKILL.md 的真实目录）、`broken-link`（断链）、`conflict`（同名多来源）。
- `adopt` 必须只作用于 `discovered` 状态的 skill；对其它状态报错。
- **adopt 物理接管**：把 discovered skill 的真实目录**移动**到 `~/.agents/skills/<name>`（通用 global source 目录），并在**原 agent 目录位置建 symlink** 指向新位置（agent 立即可用、已受管，无需手动 install）。
- adopt 后在 `config.toml` 写 `[skill-overrides.<name>] managed = true`，下次 `refresh` 该 skill 状态为 `managed`。
- 原则：agent 目录（`~/.pi/agent/skills` 等）是纯 symlink 区，真实 skill 只存在于 source 目录；scanner 扫 agent-dir 时跳过 symlink（它们是安装产物）。
- 目标位置 `~/.agents/skills/<name>` 若已存在同名，adopt 报错不覆盖。
- `ignore` 写入后 `refresh` / `discover` 不再把它列为需处理项；`skill list` 仍可显示（带 ignored 标记）。

### R6. 安全与隔离

- 所有新增写操作（source 增删、clone、import 复制、prefer/ignore/adopt）必须有对应单元测试，且测试使用临时 `ASM_HOME` + 临时目录，不碰真实 `~/.agents/skills` / `~/.pi/agent/skills` 等。
- git 操作通过 node 内置 `node:child_process`（`execFile`）调用系统 `git`，不引入 `execa` / `isomorphic-git` 等额外或纯 JS 实现（execa 未装且 `pnpm add` 受限；保持与系统 git 行为一致，并符合现有代码全用 node 内置模块的风格）。

## Acceptance Criteria

- [ ] `asm source add <dir>` 后 `config.toml` 出现新 `[[sources]]`，`asm source list` 能展示。
- [ ] `asm source add-repo <url>` 成功 clone 到 `repos/`，并注册为 `git-repo` source。
- [ ] `asm source sync` 对新仓库 clone、对已有仓库 `pull --ff-only`。
- [ ] `asm source enable/disable/remove <id>` 正确修改 config，对未知 id 报错。
- [ ] `asm skill add <dir>` 注册为 `single-skill` source。
- [ ] `asm skill import <dir>` 复制到 `local/` 并注册。
- [ ] `asm skill prefer <name> --source <id>` 后该 skill status 变 `managed`，`install` 默认用 preferred source。
- [ ] 重复 add 相同 path 报错或 skip，不产生重复 source。
- [ ] `asm discover` 能列出 discovered/external/broken-link/conflict 四类。
- [ ] `asm adopt <discovered-skill>` 把真实目录移动到 `~/.agents/skills/<name>`，并在原 agent 目录位置建 symlink 回装（agent 立即可用），下次 refresh 状态变 `managed`。
- [ ] agent 目录里的 symlink 不被 scanner 当作散落 skill（自动跳过）。
- [ ] `asm ignore <skill>` / `asm unignore <skill>` 正确切换，refresh 后状态保留。
- [ ] prefer / ignore 状态在多次 refresh 后不丢失。
- [ ] 新增功能全部有单元测试，`pnpm typecheck` + `pnpm test` 通过。
- [ ] 所有测试使用临时 `ASM_HOME`，不触碰真实 agent 目录。

## Open Decisions（已收敛）

1. ✅ `prefer` / `ignore` / `adopt` 持久化位置 → **config.toml `[skill-overrides]` 表**（方案 B，符合数据分层）。
2. ✅ `adopt` 语义 → **物理接管**：真实目录移动到 `~/.agents/skills/<name>`，原 agent 目录位置建 symlink 回装（立即可用）；写 `managed` override。
3. source id 生成策略：path/url slug，冲突加 `-2`，允许 `--id` 自定义（design 推荐）。
4. `source remove` 默认不删 repos 目录，提供 `--purge`（design 推荐）。

## Notes

- 沿用已归档任务的数据模型（SourceConfig / SkillCandidate / SkillRecord / InstallationRecord），不重构。
- 沿用既有 CLI 风格（cac，命令内联实现或拆到 `src/cli/commands/`）。
- 遵循 `.trellis/spec/backend/quality-guidelines.md` 的安全契约（symlink、原子写、ASM_HOME 隔离）。
