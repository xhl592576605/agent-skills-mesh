# Agent Skills Mesh TUI MVP

## Goal

为 Agent Skills Mesh 实现基于 Ink/React 的终端 UI（PRD Phase 7），让用户在终端里直观查看 Skill × Agent 安装状态，并通过 pending plan 安全地批量安装/卸载，而无需记忆 CLI 命令。同时补齐 PRD R7 遗漏的 `asm skill search <keyword>` 子命令。

## Background

- CLI 核心闭环（Phase 0–6）已全部完成：init/refresh/skill/source/install/uninstall/discover/adopt/ignore/doctor。
- TUI 是归档 design.md（`.trellis/tasks/archive/2026-07/07-02-agent-skills-mesh/design.md`）规划的最后一阶段。
- 当前 `package.json` 未引入 `ink`/`react`，`src/tui/` 不存在。
- `.trellis/spec/frontend/**` 已为未来 TUI 预置约束（目录结构、组件边界、状态管理、类型安全、hooks、质量）。

## Confirmed Facts（来自代码库，无需用户确认）

### 可直接复用的服务层 API
- `refreshIndex(config, previous)` → `IndexFile`（`refresh-service.ts`）
- `listDiscover(index)` → `DiscoverEntry[]`（`discover-service.ts`）
- `adoptSkill(...)` / `setIgnored(...)`（`discover-service.ts`）
- `runDoctor(configStore, indexStore)` → `DoctorCheck[]`（`doctor-service.ts`）
- `buildInstallPlan` / `applyInstallPlan` / `buildUninstallPlan` / `applyUninstallPlan` / `selectCandidate`（`install-service.ts`）
- `detectInstallations(config, skills)`（`install-service.ts`）
- 数据源：`IndexFile.skills`、`IndexFile.installations`、`IndexFile.issues`

### Frontend spec 硬约束（必须遵守）
- 目录：`src/tui/{App.tsx, screens/{MatrixScreen,DiscoverScreen,DoctorScreen}.tsx, components/, hooks/}`
- 组件只做渲染与交互收集；域行为留在 `src/core/services/**`，不复制扫描/安装/doctor 逻辑。
- Props 复用核心类型：`SkillRecord`、`InstallationRecord`、`InstallPlan`、`DoctorCheck`、`DiscoverEntry`；readonly props；回调表达用户意图。
- 状态机：`Idle → SelectingSkill → EditingMatrix → PendingPlan → ReviewPlan → Applying → RefreshIndex → Idle`。
- 文件系统变更必须先 `buildXxxPlan` 再 `applyXxxPlan`，apply 后刷新 index。
- Hooks 置于 `src/tui/hooks/`，`.tsx`/`.ts` 按是否含 JSX 区分。
- 终端安全文本与符号，不依赖单一颜色。
- 测试：TUI 行为须经 Vitest 覆盖（plan/apply 走临时目录）。

### 依赖
- 引入 `ink` + `react`（+ 类型），测试可用 `ink-testing-library`。
- CLI 框架保持 `cac`，新增 `asm tui` 子命令。

## Requirements

### R1. 入口
- 新增 `asm tui` 启动 TUI。

### R2. Matrix 屏幕（核心）
- 展示 Skill × Agent 安装状态矩阵，符号：`✓ installed / ○ available / × unsupported / ! conflict / ~ pending`。
- 交互模型（用户已确认）：逐格 toggle + 行快捷键。
  - `↑↓←→` 移动光标；`space` toggle 当前格 pending 安装/卸载。
  - `a / d` 对整行 enabled agent 批量标记安装 / 卸载。
  - `enter` 进入 pending plan review；`r` 刷新 index。
- pending 为批量累积：用户可标记多格后统一 review，确认后逐条 apply，最后统一 refresh index（符合 design 状态机）。

### R3. Discover 屏幕（含交互）
- 展示 `listDiscover(index)` 的 discovered/external/broken-link/conflict 条目。
- 支持 `adopt`（纳入管理）与 `ignore`（忽略）操作，调用 `adoptSkill` / `setIgnored`。
- 支持跳转到对应 skill / Matrix。

### R4. Doctor 屏幕（含交互）
- 展示 `runDoctor(...)` 的 `DoctorCheck[]`。
- 一键修复覆盖三类可自动修复项（用户已确认，需扩展 service 层）：
  - `index stale/missing` → `refreshIndex()`。
  - `agent skills_dir missing` → `ensureDir()`。
  - `broken-link` → 新增 repair symlink 函数（unlink + 重建 symlink 到 preferred candidate）。
- 仅展示不自动修复：`source missing`（外部路径/git）、`not writable`（权限）、`conflict`（需 prefer/force，MVP 缓）。
- 修复均经 plan 确认后 apply，apply 后刷新 index。

### R5. 安全流
- 所有写操作经 pending plan → review → apply → refresh，不直接改文件系统。

### R6. skill search（补齐 PRD R7）
- `asm skill search <keyword>` 按名称/描述关键词过滤 skill 列表。

## Acceptance Criteria

- [ ] `asm tui` 能进入 TUI 并展示 Matrix。
- [ ] Matrix 正确渲染 Skill × Agent 状态符号，与 CLI `install --dry-run` plan 一致。
- [ ] 能在 Matrix 标记 pending 安装/卸载，生成 plan，review 后 apply，apply 后矩阵状态刷新。
- [ ] Discover 屏幕展示与 `asm discover` 一致的条目。
- [ ] Doctor 屏幕展示与 `asm doctor` 一致的检查结果。
- [ ] 无任何按键直接修改文件系统；变更均经 plan 确认。
- [ ] `asm skill search <keyword>` 能按关键词过滤。
- [ ] `pnpm typecheck` 与 `pnpm test` 通过；TUI 交互有 Vitest 覆盖。

## Out of Scope（第一轮不做）
- `asm` 默认进入 TUI（保持显式 `asm tui`）。
- 引入全局状态库（用最小本地 TUI 状态容器）。
- Windows 完整兼容保证。

## 第一轮交付范围（用户已确认：最大范围）
- Matrix 全交互 + Discover 全交互（adopt/ignore/跳转）+ Doctor 全交互（一键修复）+ skill search + `asm tui` 入口。

## Open Questions
- 无阻塞性产品问题。剩余技术细节（pending apply 失败策略、Ink/React 版本、状态容器、Discover 跳转语义）在 `design.md` 落实。
