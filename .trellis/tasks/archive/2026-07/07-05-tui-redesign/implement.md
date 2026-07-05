# Implement — TUI 重设计执行计划

> 配套 `prd.md` + `design.md`。本文是有序执行 checklist。采用 **inline workflow**（Phase 2 由 `trellis-before-dev` 注入 spec，不依赖 jsonl）。

## 前置确认（开工前必做）

- [ ] **P0.1** 确认本机 Bun 已装：`bun --version`（≥ 1.1）。未装则 `curl -fsSL https://bun.sh/install | bash`。
- [ ] **P0.2** 确认 `@opentui/core` 在本机平台有预编译二进制（darwin-arm64）。`bun add @opentui/core` 试装，跑 hello world。
- [ ] **P0.3** 跑通 opentui solid 最小示例（`render(() => <box><text>hi</text></box>)`），验证 native 渲染器在 Bun 下工作。
- [ ] **P0.4** 记录基线：`pnpm test` 当前状态（TUI 13 excluded，其余绿）+ `pnpm typecheck` 绿。

## Phase 1 — 依赖与运行时迁移（R1/R2）

- [ ] **1.1** `package.json`：移除 `ink`/`react`/`@types/react`/`ink-testing-library`/`tsx`；新增 `@opentui/core`/`@opentui/solid`/`@opentui/keymap`/`solid-js`。
- [ ] **1.2** `scripts`：`dev` 改 `bun run src/cli/index.ts`；`build`/`test`/`typecheck` 保留。
- [ ] **1.3** `tsconfig.json`：设 `jsx: "preserve"`（⚠️ 不是 react-jsx，Phase 0 验证）+ `jsxImportSource: "@opentui/solid"`。
- [ ] **1.4** 旧 `src/tui/**` 处置（review 维度 7.6，明确二选一）：**方案 A（推荐）**：tsconfig 临时加 `"exclude": ["src/tui"]` 让 typecheck 跳过旧 tui（保留可对比，Phase 7 删）；`src/cli/index.ts` 的 `tui` command 临时改为「迁移中」提示（去掉对旧 App 的懒加载 import）。**不要**尝试"让旧 .tsx 在无 react 类型下编译通过"——做不到。
- [ ] **1.5** 验证：`pnpm install` 成功；`bun run src/cli/index.ts --version` 正常；`pnpm typecheck` 对 core/cli 仍绿（tui 暂时排除编译，或临时 `.tsx` 让它先过）。
- [ ] **1.6** 评估 bin shebang（见 design §2，开发期先用 node 入口包一层检测，正式分发待定）。

**验证命令**：`pnpm install && bun run src/cli/index.ts refresh && pnpm typecheck`

## Phase 2 — TUI 基础设施骨架（design §3/§4/§5/§7/§8）

- [ ] **2.1** `src/tui/theme/index.ts`：RGBA 主题（design §8 配色）。
- [ ] **2.2** `src/tui/context/theme.tsx`：ThemeProvider + useTheme。
- [ ] **2.3** `src/tui/context/data.tsx`：DataProvider —— 加载 config/index（首次缺失自动 refresh），createStore snapshot，暴露 refresh/reload。**复用** `ConfigStore`/`IndexStore`/`refreshIndex`，不重写。
- [ ] **2.4** `src/tui/context/dialog.tsx`：DialogProvider + useDialog（弹窗栈，ESC/ctrl+c/遮罩关闭，焦点管理）——移植 opencode `src/ui/dialog.tsx` 模式到 Solid。
- [ ] **2.5** `src/tui/dialogs/Dialog.tsx`：基础浮层（position absolute + zIndex + RGBA 遮罩）。
- [ ] **2.6** `src/tui/dialogs/ConfirmDialog.tsx`：含 `ConfirmDialog.show(dialog, title, message): Promise<boolean>`。
- [ ] **2.7** `src/tui/index.tsx`（run 导出 + render）+ `App.tsx`（Provider 装配 + TabBar 占位 + StatusBar 占位）。⚠️ APFS 大小写不敏感，勿用 app.tsx（与 App.tsx 冲突）。
- [ ] **2.8** `src/tui/index.ts`：`run()` 导出。
- [ ] **2.9** 接线：`src/cli/index.ts` 的 `tui` command 改为懒加载 `run()`（保留 isTTY 检测）。
- [ ] **2.10** 验证：`bun run src/cli/index.ts tui` 能启动，显示 TabBar + 空白视图 + ESC 退出。

**验证命令**：`bun run src/cli/index.ts tui`（手动：启动/ESC 退出/切换 tab 占位）

## Phase 3 — SkillAgentView + Matrix（R3，核心，design §6）

- [ ] **3.1** `src/tui/state/matrix.ts`：cursor signal + pending store（skillName→agentId→intent）。
- [ ] **3.2** `src/tui/state/search.ts`：搜索词 signal。
- [ ] **3.3** `src/tui/components/Matrix.tsx`：表格渲染（表头 + 行 + 单元格标签 `[on]`/`[off]`/`—`/`[!]`/`[+]`/`[-]`）。复用 `buildAgentColumns` 投影逻辑（从旧 `Matrix.tsx` 移植，换载体）。
- [ ] **3.4** `src/tui/components/SearchBar.tsx`：`/` 触发 fuzzy 过滤 skill。
- [ ] **3.5** `src/tui/components/Inspector.tsx`：选中 skill 详情（来源/hash/agents/pending）。
- [ ] **3.6** `src/tui/components/StatusBar.tsx`：底部状态 + 快捷键栏（动态提示当前 tab 操作）。
- [ ] **3.7** `src/tui/views/SkillAgentView.tsx`：装配 Matrix + Inspector + StatusBar + 搜索。
- [ ] **3.8** 交互：`↑↓←→` 光标、`enter` toggle、`a`/`d` 批量行、`/` 搜索、滚动窗口。
- [ ] **3.9** 写操作链：pending → `enter` review → ConfirmDialog → `buildInstallPlan`/`buildUninstallPlan` + `applyInstallPlan`/`applyUninstallPlan` → refresh → setSnapshot。
- [ ] **3.10** 验证：手动跑全流程（toggle/批量/确认/refresh 回写）。

**验证命令**：`bun run src/cli/index.ts tui`（手动 Matrix 全流程）+ 单元测试（Phase 5 补）

## Phase 4 — Source / Doctor 视图（R4/R6，design §9）

- [ ] **4.1** `src/tui/views/SourceView.tsx`：source 列表表格 + 操作（add/update/remove/enable/disable）。
- [ ] **4.2** `src/tui/dialogs/AddSourceDialog.tsx`：target/branch/type 输入表单（复用 `addSource` service 的类型推断）。
- [ ] **4.3** `src/tui/dialogs/SelectDialog.tsx`：通用选择（rebind source / skill add 多来源 / remove --purge）。
- [ ] **4.4** `src/tui/dialogs/PromptDialog.tsx`：通用输入。
- [ ] **4.5** Source 操作接 service：`addSource`/`sourceUpdate`/`removeSource`/`setSourceEnabled`，每个写操作走对应弹窗确认。
- [ ] **4.6** `src/tui/views/DoctorView.tsx`：issues 列表 + adopt 候选 + `f` 修复（复用 `runDoctor` + `buildRepairPlan`/`applyRepairPlan`）。
- [ ] **4.7** `src/tui/dialogs/SkillDetailDialog.tsx`：skill info（对应 `skill info`）。
- [ ] **4.8** 全局快捷键：`r` refresh、`1`/`2`/`3` 切 tab、`?` help 弹窗。
- [ ] **4.9** 验证：Source/Doctor 各操作 + 弹窗确认流程。

**验证命令**：`bun run src/cli/index.ts tui`（手动 Source/Doctor 全流程）

## Phase 5 — 测试重写（R8/AC8，design §10）

- [ ] **5.1** `vitest.config.ts`：移除 TUI exclude（恢复 include）。
- [ ] **5.2** 测试工具：封装 `createTestRenderer` 辅助（renderOnce/captureCharFrame/mockInput）。
- [ ] **5.3** Matrix 测试：渲染快照、光标移动、toggle、批量行（a/d）、搜索过滤。
- [ ] **5.4** 弹窗测试：ConfirmDialog show/确认/取消/ESC、AddSourceDialog 提交、SelectDialog 选择。
- [ ] **5.5** 写操作链测试：pending→plan→apply→refresh（含 conflict 路径）。
- [ ] **5.6** Doctor view 测试：issues 渲染 + 修复。
- [ ] **5.7** state store 测试：snapshot/pending/matrix 纯操作（替代旧 reducer 纯函数测试）。
- [ ] **5.8** 验证：`pnpm test` 全绿，TUI 覆盖恢复。

**验证命令**：`pnpm test`

## Phase 6 — frontend spec 更新（R9/AC9）

- [ ] **6.1** `.trellis/spec/frontend/directory-structure.md`：`src/tui/**` 新结构（views/dialogs/context/state/theme）。
- [ ] **6.2** `component-guidelines.md`：Ink/React → Solid + opentui（box/text 原语、props 约定、Portal）。
- [ ] **6.3** `hook-guidelines.md` → 改名/改写为 `solid-patterns.md`：createSignal/createStore/createEffect/onMount/onCleanup、useKeyboard/useRenderer。
- [ ] **6.4** `state-management.md`：snapshot+pending 模型（Solid store 载体）+ DialogProvider 弹窗栈。
- [ ] **6.5** `type-safety.md`：复用 core model 类型（SkillRecord/InstallPlan/DoctorCheck），solid-js 类型。
- [ ] **6.6** `quality-guidelines.md`：opentui testing 验证、不依赖颜色、弹窗确认安全模型、CLI 行为不受影响。
- [ ] **6.7** `index.md`：更新概览（不再是 Ink/React）。
- [ ] **6.8** 验证：spec 无 Ink/React 残留，无 placeholder。

**验证命令**：`grep -ri "ink\|react" .trellis/spec/frontend/`（应为空或仅历史引用）

## Phase 7 — 收尾与清理

- [ ] **7.1** 删除旧 `src/tui/**`（Ink/React 实现，已被新结构替换）。
- [ ] **7.2** 删除旧 TUI 测试文件（已在 Phase 5 用新测试替代）。
- [ ] **7.3** `pnpm typecheck` + `pnpm test` 双绿。
- [ ] **7.4** 手动 smoke：`asm init`(已存在跳过) → `refresh` → `tui` 全流程（三个 tab + 弹窗 + 搜索）。
- [ ] **7.5** 非 TTY 降级验证：`echo "" | bun run src/cli/index.ts tui` 应打印提示而非崩溃。
- [ ] **7.6** 更新 journal + 走 trellis-check + finish-work。

**验证命令**：`pnpm typecheck && pnpm test && bun run src/cli/index.ts tui`

## 风险点与回滚

| 风险 | 触发条件 | 回滚 |
|---|---|---|
| opentui native 装机失败 | 平台无预编译 / Bun 版本旧 | 回退 Phase 1，保留旧 Ink tui，评估 Node FFI |
| Bun 下 core/cli 测试红 | node API 不兼容 | 单独定位（child_process/fs），必要时该测试保留 node 运行 |
| Solid 学习成本超预期 | 进度卡在 Phase 3 | 缩小 MVP：先只做 SkillAgentView + ConfirmDialog，Source/Doctor 留 CLI |
| 固定宽高在小终端崩 | 终端 < 80x24 | 加 minWidth 守卫 + 降级提示 |

**关键回滚点**：core service 层零改动 → 任何时候用户都能完整用 CLI 操作；旧 `src/tui/**` 在 git 历史可恢复。

## 依赖与顺序

严格串行：Phase 1 → 2 → 3 → 4 → 5 → 6 → 7。Phase 2 是所有视图的基础（context/dialog/theme）。Phase 3/4 可部分并行（不同视图），但共享 Phase 2 的弹窗/状态。

## 子任务拆分建议（可选）

若规模过大，可拆 child task（父 task 持 prd/design，子 task 持各 Phase 的 implement）：
- child-1: 依赖迁移 + 基础设施（Phase 1+2）
- child-2: Matrix 视图（Phase 3）
- child-3: Source/Doctor 视图 + 弹窗（Phase 4）
- child-4: 测试 + spec（Phase 5+6）

**建议**：先按单 task 推进到 Phase 2 验收，再评估是否拆。
