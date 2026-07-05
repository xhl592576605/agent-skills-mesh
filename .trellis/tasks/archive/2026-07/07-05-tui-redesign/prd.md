# TUI 重设计（框架选型 + 交互范式）

## Goal

将 `asm tui` 从当前「难用」的 Ink/React 矩阵 TUI，重写为基于 **`@opentui/core` + `@opentui/solid`**（opencode 同款）的现代终端 UI：支持 **web 风格浮层弹窗**、**固定宽高布局**、**丰富颜色**、fuzzy 搜索，交互直观易学，**功能对齐全 CLI**。

## Background

### 现有 TUI（待整体替换）

- 框架：**Ink 5 + React 18**，代码在 `src/tui/**`，CLI `asm tui` 懒加载渲染（`src/cli/index.ts` 的 `tui` command）。
- 三屏 Matrix/Discover/Doctor：方向键移动光标 + 字符快捷键（`a`/`d`/`r`/`space`/`enter`/`tab`/`1-3`）+ 符号矩阵（`✓ ○ × ! ~/~-`，见 `src/tui/components/Matrix.tsx` `cellSymbol`）。
- 数据流：`useIndexState` 加载 config/index（首次缺失自动 refresh）→ `SET_SNAPSHOT` → reducer → 屏幕消费；写操作经 `buildInstallPlan`/`buildUninstallPlan`（`src/core/services/install-service.ts`）。
- **13 个 TUI 测试在 `vitest.config.ts` 被 exclude**（留给本任务重写）。
- frontend spec（`.trellis/spec/frontend/`）当前规划的是 Ink/React 边界。

### 用户痛点（brainstorm #1 确认）

- **符号语义难记**：矩阵符号（`✓/○/×/!/~/~-`）信息密度高、语义靠背。
- **逐格导航低效**：方向键在 skill×agent 矩阵逐格移动，无搜索/跳转。
- **Ink 能力不足**：想要边框面板 / 滚动列表 / 鼠标 / 多栏布局等「原生 TUI 感」，Ink 全屏重绘做不到（Ink 无绝对定位 / zIndex / RGBA 透明 / 原生鼠标）。
- （未选）快捷键难记 —— 用户不认为这是主因。

### 技术调研结论（brainstorm #2）

用户指定采用 opencode 同款 `@opentui/core`，已调研确认：

- **`@opentui/core`**：native Zig 核心 + TypeScript 绑定的终端 UI 引擎，npm 公开（最新 0.4.3，opencode catalog 锁 0.3.4），生产级（驱动 opencode / terminal.shop）。能力覆盖所有痛点：`<box position="absolute" zIndex>` + `RGBA` 半透明遮罩 → **web 风格浮层弹窗**；flex 布局 + 固定 `width`/`height` → **固定宽高**；RGBA → **丰富颜色**；内置 `Select`/`ScrollBox`/`TabSelect`/`Input` 等组件 → **列表/搜索/tab**。
- **弹窗模式**（参考 opencode `src/ui/dialog.tsx`）：`DialogProvider` 维护弹窗栈 → `useDialog().replace(element, onClose)` 推栈 → `DialogConfirm.show()` 返回 `Promise<boolean>`（异步 await 确认）。ESC / 点击遮罩外部 / ctrl+c 关闭，含焦点管理。
- **两个 reconciler**：`@opentui/react`（React）与 `@opentui/solid`（SolidJS，opencode 使用）。
- **运行时约束**：原生渲染器需 Bun，或 Node 26.3+ experimental FFI。
- **资源**：文档 opentui.com/docs；AI skill `npx skills add anomalyco/opentui`；Testing / Layout / Colors 专章。

## Confirmed Decisions（brainstorm 收敛）

| # | 决策 | 选择 | 理由 |
|---|---|---|---|
| 3 | Reconciler | **`@opentui/solid`** | opencode 同款，可直接参考其 dialog/command-palette/theme 代码 |
| 4 | 运行时 | **Bun** | opencode 同款，@opentui 原生支持，免去 tsx，启动快；core/cli 层透明兼容 |
| 5 | 交互范式 | **Matrix 表格化重做** | 保留 skill×agent 核心语义，用 opentui 表格组件解决符号/导航痛点 |
| 6 | 视图组织 | **顶部 Tab**（Skill×Agent / Source / Doctor） | 简单直观，贴效果图，与 CLI 三层命令心智一致 |
| 7 | 测试 | **13 个按新架构重写** | 适配 solid signals/stores + opentui testing，保持覆盖 |
| 7 | spec | **frontend 六篇全改** | Ink/React → SolidJS + opentui |

**Matrix 表格化交互细节**（决策 #5 展开）：
- 行 = skill，列 = agent；单元格用 `[on]`/`[off]`/`—`/`[!]` 文字标签（替代难记符号）。
- `enter` 切换当前单元格；`a` 行全装；`d` 行全卸；`/` fuzzy 搜索；可滚动。
- 写操作（toggle / batch）经浮层弹窗确认后 apply，复用 `buildInstallPlan`/`buildUninstallPlan`。

**视图组织细节**（决策 #6 展开）：
- `[1 Skill×Agent]`（Matrix，默认）`[2 Source]` `[3 Doctor]`，数字键 1/2/3 切换。
- Source tab：source 列表 + add/update/remove/enable/disable（操作走弹窗）。
- Doctor tab：health issues + 可 adopt 候选技能（CLI 重构后 discover 已并入 doctor）。

## Constraints

1. **复用 core service 层**：`src/core/services/**`（source/skill/agent/install/doctor/refresh）定型，TUI 只做渲染 + 收集意图，不内联域逻辑。
2. **CLI 安全模型**：任何 FS 写操作先经 plan 构建（`buildInstallPlan`/`buildUninstallPlan`/repair plan），UI 有 review/confirm 步骤。
3. **终端可访问性**：键盘优先；不依赖颜色单独传递信息（文字标签 + 状态文字冗余）。
4. **非 TTY 降级**：保留现有 `process.stdout.isTTY` 检测（`src/cli/index.ts` tui command）。
5. **TS ESM**（NodeNext，`.js` 扩展），Vitest，保持 `typecheck` + `test` 双绿。

## Requirements

- **R1 框架迁移**：移除 `ink`/`react`/`ink-testing-library` 依赖；引入 `@opentui/core`、`@opentui/solid`、`@opentui/keymap`、`solid-js`；删除 `src/tui/**` 旧 Ink/React 实现，按 SolidJS 重建。
- **R2 运行时迁移**：`dev` 改 `bun run`（去 tsx）；`build` 产出 dist（tsc 或 bun build）；`test` 仍 vitest（bun 兼容）；bin 入口评估 shebang/分发。
- **R3 Matrix 表格化**：skill×agent 交叉表格（opentui 表格/box 组件），`[on]`/`[off]`/`—`/`[!]` 文字标签；`enter` toggle / `a` 行全装 / `d` 行全卸；`/` fuzzy 搜索过滤；可滚动。
- **R4 顶部 Tab 视图**：`[1 Skill×Agent] [2 Source] [3 Doctor]`，数字键切换；Source tab 覆盖 add/update/remove/enable/disable；Doctor tab 覆盖 health issues + adopt 候选。
- **R5 浮层弹窗**：实现 `DialogProvider` 弹窗栈 + `confirm`/`prompt`/`select` 弹窗（参考 opencode `src/ui/dialog.tsx`）；所有写操作（add source / remove / delete / toggle 确认等）走浮层弹窗；ESC / 遮罩点击 / ctrl+c 关闭；焦点管理。
- **R6 功能对齐 CLI**：覆盖 `source add/update/remove/list/enable/disable`、`skill search/add/list/info/update/remove/rebind/enable/disable`、`refresh`、`doctor`；`init` 仍留 CLI（TUI 启动前检测 config 存在）。
- **R7 主题与布局**：固定宽高布局（box `width`/`height`）；RGBA 丰富颜色（参考效果图深色底 + 黄/绿/蓝强调）；主题集中管理（参考 opencode `src/theme/`）。
- **R8 测试重写**：13 个被 exclude 测试按新架构重写（solid stores/signals + opentui testing），恢复 `vitest.config.ts` 的 include。
- **R9 spec 更新**：frontend spec 六篇（directory-structure / component-guidelines / hook-guidelines / state-management / type-safety / quality-guidelines）从 Ink/React 改写为 SolidJS + opentui。

## Acceptance Criteria

- [ ] **AC1** `asm tui` 在 Bun 下启动，渲染顶部 Tab 栏 + Matrix 表格（skill×agent，`[on]`/`[off]` 标签）。
- [ ] **AC2** Matrix：`enter` toggle 单元格、`a` 行全装、`d` 行全卸，经弹窗确认后 apply，复用 `buildInstallPlan`/`buildUninstallPlan`，结果回写 snapshot。
- [ ] **AC3** `/` 触发 fuzzy 搜索，实时过滤 skill 行。
- [ ] **AC4** `1`/`2`/`3` 切换 Skill×Agent / Source / Doctor tab；Source tab 可 add/update/remove/enable/disable source；Doctor tab 可查看 issues + adopt 候选 + 修复。
- [ ] **AC5** add source / remove skill / delete 等写操作弹出 **web 风格浮层**（绝对定位 + zIndex + 半透明遮罩），ESC / 遮罩点击可关闭，确认后执行。
- [ ] **AC6** 非 TTY 环境友好降级（保留 isTTY 检测，打印提示而非崩溃）。
- [ ] **AC7** 信息传递不依赖颜色：状态用文字标签（`[on]`/`[off]`/`installed`/`conflict`）冗余表达。
- [ ] **AC8** 旧 `tests/tui/**`（**5 文件 47 cases**：matrix 7 / discover 6 / doctor 3 / reducer 26 / use-install-plan 5）的行为按新架构重写并通过（见 design §10 映射）；`vitest.config.ts` 不再 exclude TUI。
- [ ] **AC9** frontend spec 六篇改写为 SolidJS + opentui：`grep -wiE "ink|react\.dom|@types/react|createElement|reactElement" .trellis/spec/frontend/` 无残留；且 `index.md`/`directory-structure.md` 关于 `src/tui/**` 存在性、package.json 依赖的事实陈述与现实一致（人工 review——旧 spec 已失实：曾称"no tui dir"实际 15 文件、"no react/ink"实际有 ink^5/react^18、"cac"实际是 commander）。
- [ ] **AC10** core service 层未被重写（`src/core/services/**` 仅按需读取，域逻辑不变）。
- [ ] **AC11** `pnpm typecheck` + `pnpm test` 全绿。
- [ ] **AC12** CLI 现有命令（source/skill/init/refresh/doctor）行为不受 TUI 重写影响。

## Out of Scope

- core service 层重写（复用现有 `src/core/services/**`）。
- `asm init` 的 TUI 化（一次性命令，留 CLI）。
- Web 前端 / 浏览器渲染。
- 跨语言方案（Bubbletea/Textual 等，项目保持 TS）。

## Open Questions（design 阶段定）

1. 主题具体配色：参考效果图（深色底 + 黄/绿/蓝）还是自定义调色板？
2. bin 全局分发：shebang `#!/usr/bin/env bun`（要求用户装 bun）vs opentui standalone executable 打包？
3. 是否引入 opencode 的 command palette（`:`触发）作为 Tab 之外的辅助交互，还是纯 Tab？
4. opentui testing 的具体 API（待查 `opentui.com/docs/core-concepts/testing`）。
