# CLI/TUI bug 批量修复（README bug 1-5）

## Goal

修复 README `TODO > bug` 区列出的 5 个缺陷（bug6「中英文切换 / i18n」工作量大，已确认单独排期，不在本批），让三层模型（source / skill-SSOT / agent）在 CLI 与 TUI 两端的「skill 列表语义、输出对齐、TUI 交互（粘贴、source 多选、agent 智能启用）」达成一致且可用。

## Background

三层职责：`source`（来源）/ `skill`（SSOT 单一可信源）/ `agent`（symlink 分发）。当前痛点（已在代码层定位根因）：

| # | 缺陷 | 根因位置 |
|---|---|---|
| 1 | `skill list` 语义混淆 | `src/cli/index.ts` 的 `skill list` 列的是 `index.skills`（来源候选），而非已 add 到 SSOT 的 `state.installedSkills`；TUI `SkillAgentView.allSkills()` 同样用 `index.skills` |
| 2 | CLI 输出未对齐 | `src/cli/skill-format.ts` `formatSkillRows` 与 source list/update 全用 `\t` 制表符 + 无表头，终端 tab 跳列错位 |
| 3 | TUI add source 无法粘贴 | `src/tui/dialogs/PromptDialog.tsx` 用 `useKeyboard` 逐字符捕获（仅收 `\x20-\x7e` 单字符），不处理 paste 事件 |
| 4 | source skill 详情缺能力 | `SelectDialog` 仅单选、`SkillDetailDialog` 不渲染 SKILL.md 正文；无标记已 add / 多选 / 批量 add |
| 5 | 默认 agent 无视安装 | `src/core/storage/config-store.ts` `createDefaultConfig` 把 claude/codex/pi 写死 `enabled=true`；无 agent 启停命令；`projection.buildAgentColumns` 保留 disabled 列 |

## Requirements

### R1 — skill list 语义统一（bug1）
- R1.1 CLI `asm skill list` 只列已 add 到 SSOT 的技能（`state.installedSkills`），不再列来源候选。
- R1.2 CLI `asm skill search [query]` 保持为「来源候选」搜索（`index.skills`），与 list 职责区分。
- R1.3 TUI `SkillAgentView` 的 matrix 行数据源改为 `state.installedSkills`，与 `skill list` 一致；单元格状态仍由 `index.installations` 计算。
- R1.4 list 输出字段：name / status / 来源 source / 已启用 agents。

### R2 — CLI 输出对齐（bug2）
- R2.1 `skill list`/`skill search`/`source list`/`source update` 的表格输出改为固定列宽对齐 + 表头行 + 分隔线。
- R2.2 长字段截断（尾部 `…`），CJK 字符按双宽计列宽（避免中文/全角错位）。
- R2.3 对齐逻辑抽成纯函数（`src/cli/columns.ts` + 改写 `formatSkillRows`），可单测断言。

### R3 — TUI add source 粘贴（bug3）
- R3.1 `PromptDialog` 支持终端粘贴（macOS `cmd+v` / `ctrl+v` / bracketed paste）。
- R3.2 通过 `useRenderer()` 监听 opentui paste 事件，将 `PasteEvent.bytes` 解码为 utf8、过滤控制字符后追加到 value。
- R3.3 保留现有 `useKeyboard` 字符捕获架构（不引入 `<input>` 组件的 focus / owner-context 风险）。

### R4 — TUI source skill 详情多选（bug4）
- R4.1 `SourceView` 的 source 详情改为多选对话框；每项前缀标记 `[✓]`（已 add）/`[ ]`（可 add），已 add 项不可勾选。
- R4.2 `space` 勾选未 add 项、`return` 一次性批量 `skillAdd`、`i` 查看单个 SKILL.md 正文。
- R4.3 批量 add 复用 `skillAdd`，部分失败时汇总成功/失败报告（StatusBar 文案）。
- R4.4 SKILL.md 用 opentui `<Markdown>` + `<ScrollBox>` 渲染。

### R5 — agent 智能启用（bug5）
- R5.1 `asm init`（首次创建或 `--force`）时按安装检测决定每个 agent 的 `enabled`：安装目录存在→enabled，否则 disabled。
- R5.2 新增 agent 启停能力：CLI `asm agent list` / `agent enable <id>` / `agent disable <id>`。
- R5.3 TUI matrix 默认隐藏 disabled agent 列，提供切换键（如 `A`）临时显示；提供 agent 启停入口。
- R5.4 安装检测判据：各 agent `skills_dir` 的父目录是否存在（claude→`~/.claude`、codex→`~/.codex`、pi→`~/.pi`、gemini→`~/.gemini`、opencode→`~/.config/opencode`、openclaw→`~/.openclaw`、hermes→`~/.hermes`）。

## Out of Scope

- bug6「中英文切换（i18n）」——单独排期，本批不碰。
- TUI 集成测试自动化（render-smoke CI）与 npm 跨平台包发布——属 README「功能」区，另列。
- 现有已存在 `config.toml`（非 `--force`）的 agent 状态不做自动迁移（避免覆盖用户选择）；用户可通过 `init --force` 或 `agent enable/disable` 调整。

## Acceptance Criteria

- [ ] **AC1** `asm skill list` 输出仅含 `state.installedSkills` 中的技能；`asm skill search` 仍返回来源候选；二者可区分。
- [ ] **AC2** `SkillAgentView` matrix 行 == `state.installedSkills`（refresh 后与 CLI `skill list` 一致）。
- [ ] **AC3** `skill list`/`skill search`/`source list`/`source update` 输出列对齐、有表头、长字段截断；CJK 文本不错位；`columns`/`formatSkillRows` 单测通过。
- [ ] **AC4** AddSourceDialog 在终端粘贴（`cmd+v`）能完整填入 target（含空格/特殊符号的 url）；PromptDialog paste 路径有单测或手动验证记录。
- [ ] **AC5** Source 详情：能标记已 add、`space` 多选、`return` 批量 add、`i` 查看 SKILL.md（Markdown 渲染、可滚动）；批量部分失败有汇总。
- [ ] **AC6** `asm init --force` 后未安装的 agent `enabled=false`；`asm agent list` 可见状态；`asm agent enable/disable <id>` 生效并落盘 config.toml。
- [ ] **AC7** TUI matrix 默认隐藏 disabled 列；切换键可显示；可在 TUI 内启停 agent。
- [ ] **AC8** `bun run typecheck` 通过；`bun run test` 全绿；新增单测（columns、listInstalledSkills、detectAgentInstalled、agent-service）通过。
- [ ] **AC9** 不引入 core 行为回归：install / doctor / skill add / skill update 链路仍正确。

## Open Questions

无 —— R1 / R4 / R5 的关键产品决策已与用户确认（matrix 行=已 add、source 详情多选范式、未装 agent 全写入+按检测启用+UI 隐藏）。R3 粘贴接入点为技术实现项（`useRenderer()` paste），在实现时验证确切 API。
