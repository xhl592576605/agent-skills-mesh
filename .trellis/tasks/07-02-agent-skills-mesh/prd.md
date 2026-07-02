# Agent Skills Mesh PRD

## Goal

构建一个面向 Claude Code、Codex、Pi、Gemini 等 Coding Agent 的统一 Skill 管理器。它只管理 Skill 的来源、扫描、索引、安装状态和多 Agent 可见性，不负责启动或调度 Coding Agent 执行任务。

核心价值：以仓库为主要分发单元，以 Source 作为真实抽象，以单个 Skill 为最小管理单元，以 Agent Installation 作为最终状态，让用户能够安全地在多个 Coding Agent 之间复用、过滤、同步和卸载 Skills。

## Background / Problem

当前生态中，Agent Skill 趋于规范化，很多用户通过自定义仓库存储 Skills，也会使用工具将 Skills 安装到 `~/.agents/skills`。现有方案存在几个缺口：

- `skill.sh` 类工具可以查找、添加 Skill 到 `~/.agents/skills`，但无法按不同 Agent 的能力和目录进行过滤，所有 Agent 都可能看到不适合自己的 Skill。
- `cc-switch` 类工具偏向 Claude 生态，不覆盖 Pi、Codex、Gemini 等其他 Agent，也不适合一键管理一个仓库里的 Skills。
- 用户可能在其他 Agent 中手动创建单个 Skill，或将 Skill 放在 `~/.agents/skills`；管理工具需要通过刷新机制发现这些外部变化并纳入索引。
- 仓库是主要管理单元，但产品必须兼容只有一个 Skill 的目录、手动添加单个 Skill、全局目录、Agent 原生目录等场景。

## Product Scope

### In Scope

- CLI + TUI Skill 管理器。
- 默认安装策略为 symlink。
- 支持 Claude Code、Codex、Pi、Gemini 四类 Agent 配置。
- 支持以下 Source 类型：
  - `git-repo`：一个 Git 仓库，可能包含多个 Skills。
  - `local-dir`：本地目录，可能包含多个 Skills。
  - `single-skill`：手动添加的单个 Skill 目录。
  - `global-dir`：例如 `~/.agents/skills`。
  - `agent-dir`：例如 `~/.claude/skills`、`~/.codex/skills`、`~/.pi/skills`、`~/.gemini/skills`。
- 自动识别 `SKILL.md`：
  - `<skill-name>/SKILL.md`
  - `skills/<skill-name>/SKILL.md`
  - 单个 Skill 目录中的 `SKILL.md`
- 解析 `SKILL.md` frontmatter 中的 `name`、`description` 等信息。
- `refresh` 扫描配置源、全局目录和 Agent 目录，更新索引。
- `discover` 展示外部创建、未托管、冲突、断链等状态。
- 安装、卸载、dry-run install plan、doctor 检查。
- TUI 至少包含 Matrix、Discover、Doctor 三个 MVP 工作台。

### Out of Scope for MVP

- 不启动 Claude Code、Codex、Pi、Gemini。
- 不做 Agent runtime 调度。
- 不做云端 marketplace。
- 不做 Skill 评分系统。
- 不做复杂 Skill 格式转换。
- 不强制迁移用户已有 Skill 目录。
- 不做完整 Windows 兼容保证；优先 macOS/Linux。
- MVP 不引入 SQLite，先使用 JSON 索引。

## Requirements

### R1. 初始化与配置

- 提供 `asm init` 初始化用户目录：`~/.agent-skills-mesh/`。
- 初始化生成：
  - `config.toml`
  - `index.json`
  - `state.json`（如 TUI 需要）
  - `repos/`
  - `local/`
  - `cache/`
- 默认注册 `~/.agents/skills` 为 `global-dir`。
- 默认生成 Claude、Codex、Pi、Gemini 的 Agent 配置，允许用户启用/禁用。

### R2. Source 管理

- 支持添加本地目录 source。
- 支持添加 Git repo source，并 clone 到 `~/.agent-skills-mesh/repos/`。
- 支持同步 Git repo：新仓库 clone，已有仓库 pull。
- 支持启用、禁用、删除 source。
- source 作为仓库级管理入口，但不能限制用户只使用仓库。

### R3. Skill 扫描与索引

- `asm refresh` 扫描所有 enabled sources、`~/.agents/skills` 和已配置 Agent 的 skills_dir。
- 识别多种目录结构中的 `SKILL.md`。
- 使用以下优先级解析名称：frontmatter `name` → 目录名。
- 使用以下优先级解析描述：frontmatter `description` → 空。
- 计算 hash、mtime、size，用于判断变更。
- 同名 Skill 多来源时保留 candidates，并标记 conflict，除非已配置 preferred source/candidate。

### R4. 外部 Skill 发现

- 用户在其他 Agent 或 `~/.agents/skills` 中创建的真实目录应被 `refresh` 发现。
- 外部发现的 Skill 应标记为 `discovered` 或 `external`，不会自动移动。
- 支持 `adopt` 原地纳入管理。
- 支持 `ignore` 后续不再提示。
- 支持 `skill import` 复制到 `~/.agent-skills-mesh/local/` 进行托管。

### R5. 安装 / 卸载

- 默认使用 symlink 安装。
- 安装前生成 install plan，支持 `--dry-run`。
- 安装规则：
  - 目标不存在：创建 symlink。
  - 目标是相同 symlink：skip。
  - 目标是不同 symlink：conflict，除非未来显式 force。
  - 目标是真实目录：conflict，默认不覆盖。
  - 源不存在：失败。
- 卸载规则：
  - 只删除 symlink。
  - 不删除 source skill。
  - 真实目录默认拒绝删除。

### R6. Doctor 检查

- 检查 config/index 是否存在。
- 检查 source 路径可访问性。
- 检查 Git repo 状态。
- 检查 Agent skills_dir 是否存在且可写。
- 检查 broken symlink。
- 检查同名 Skill 冲突。
- 检查 index 是否过期或需 refresh。

### R7. CLI 命令

MVP 命令树：

```txt
asm
├── init
├── refresh
├── doctor
├── discover
├── source
│   ├── list
│   ├── add <path>
│   ├── add-repo <git-url>
│   ├── sync [id]
│   ├── remove <id>
│   ├── enable <id>
│   └── disable <id>
├── skill
│   ├── list
│   ├── search <keyword>
│   ├── info <name>
│   ├── add <path>
│   ├── import <path>
│   └── prefer <name> --source <source-id>
├── install <skill>
└── uninstall <skill>
```

第一轮实现优先闭环：`init`、`refresh`、`skill list/info`、`install --dry-run`、`install`、`uninstall`、`doctor`。

### R8. TUI MVP

- 默认可通过 `asm tui` 进入；后续可考虑 `asm` 默认进入 TUI。
- Matrix 是核心界面，展示 Skill × Agent 安装状态。
- Discover 处理外部发现、未托管、断链、冲突。
- Doctor 展示检查结果和修复建议。
- TUI 操作必须先生成 pending plan，不应直接修改文件系统。

## Acceptance Criteria

- [ ] `asm init` 能创建默认配置和数据目录。
- [ ] `asm refresh` 能扫描 `~/.agents/skills`、配置 sources 和 Agent skills_dir。
- [ ] `asm skill list` 能列出扫描到的 Skills。
- [ ] `asm skill info <name>` 能展示 candidates、source、path、description、安装状态和冲突信息。
- [ ] 能识别 `repo/skills/foo/SKILL.md`、`repo/foo/SKILL.md`、`single-skill/SKILL.md` 三类结构。
- [ ] 同名 Skill 多来源时标记 conflict，不静默覆盖。
- [ ] `asm skill prefer <name> --source <source-id>` 后默认安装使用 preferred source。
- [ ] `asm install <skill> --agent pi --dry-run` 输出 install plan，且不修改文件系统。
- [ ] `asm install <skill> --agent pi` 创建 symlink。
- [ ] 重复安装相同 symlink 时 skip。
- [ ] 目标存在真实目录时报告 conflict，不覆盖。
- [ ] broken symlink 能被 `refresh` / `doctor` 检测。
- [ ] `asm uninstall <skill> --agent pi` 只删除 symlink，不删除 source。
- [ ] 用户在 `~/.agents/skills` 或 Agent 目录中手动创建的 Skill 能被 `discover` 展示。
- [ ] TUI Matrix 能展示 Skill × Agent 状态，并能生成安装/卸载 pending plan。
- [ ] Doctor 能输出 config/index/source/agent-dir/symlink/conflict 的检查结果。

## Technical Constraints

- 语言：TypeScript。
- Runtime：Node.js。
- 包管理：pnpm。
- CLI：优先 `cac`。
- TUI：Ink + React。
- 配置：TOML。
- 索引：MVP 使用 JSON，后续可迁移 SQLite。
- Markdown frontmatter：`gray-matter`。
- Git：`execa` 调用 git。
- 测试：Vitest。

## Open Questions

当前无阻塞性产品问题。实现前仍需由用户确认是否从第一轮 CLI 核心闭环开始编码。
