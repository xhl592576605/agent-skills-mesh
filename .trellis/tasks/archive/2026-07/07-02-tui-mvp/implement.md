# Agent Skills Mesh TUI MVP — Implementation Plan

## 执行策略

自底向上：先扩 service 层（纯逻辑、易测），再建 TUI 状态容器（纯 reducer、易测），最后上屏幕组件与 CLI 接线。每阶段都有独立验证，可单独回滚。

## Phase A. 依赖与工程骨架

- [ ] `pnpm add ink@^5 react@^18 && pnpm add -D ink-testing-library@^4 @types/react@^18`
- [ ] `tsconfig.json`：`"jsx": "react-jsx"`，`"moduleResolution": "NodeNext"` 保持（Ink 5 支持 ESM）。
- [ ] 创建 `src/tui/` 空骨架目录（按 design 目录结构）。
- [ ] 确认 `pnpm typecheck`、`pnpm test` 仍绿（无回归）。

验证：
```bash
pnpm typecheck && pnpm test
```

## Phase B. service 层扩展（核心，先做透）

文件：`src/core/services/skill-service.ts`、`install-service.ts`、`doctor-service.ts` + 对应 `tests/`。

- [ ] `searchSkills(index, keyword)` in `skill-service.ts`（name/displayName/description/tags 子串，大小写不敏感）。
- [ ] `DoctorCheck` 扩展 `fix?: DoctorFix`（见 design §1）；`runDoctor` 为 index-missing / agent-dir-missing / broken-link 附带 `fix`。
- [ ] `buildRepairPlan` / `applyRepairPlan` in `install-service.ts`（unlink symlink + 重建 symlink；真实目录/文件拒绝并 conflict）。
- [ ] 单测：
  - `searchSkills` 命中 name/desc/tag、空 keyword 返回全部。
  - `runDoctor` 对 broken-link 产出的 check 带 `fix.type === "repair-broken-link"` 且含 skillName/agentId。
  - `buildRepairPlan` + `applyRepairPlan` 在临时目录修复 broken-link；真实目录时 hasConflict。

验证：
```bash
pnpm test -- skill-service doctor-service install-service
```

## Phase C. TUI 状态容器（纯逻辑）

文件：`src/tui/state/{types.ts,reducer.ts}`、`src/tui/hooks/{useTuiApp.ts,useIndexState.ts}`。

- [ ] `TuiState`、`TuiAction` 类型；reducer 纯函数（屏切换、光标移动、pending toggle、行批量 a/d、apply 结果归并、focusSkill 设置）。
- [ ] `useIndexState`：读 ConfigStore/IndexStore，index 缺失时 refreshIndex；暴露 `refresh()`、`reload()`。
- [ ] reducer 单测：toggle 累积、行批量对 enabled agent、再次 toggle 取消、focusSkill 设置。

验证：
```bash
pnpm test -- tui/state tui/hooks
```

## Phase D. Matrix 屏幕 + PlanReviewModal

文件：`screens/MatrixScreen.tsx`、`components/{Matrix.tsx,PlanReviewModal.tsx,SkillInspector.tsx,Layout.tsx,StatusBar.tsx}`、`hooks/useInstallPlan.ts`。

- [ ] `Matrix` 受控纯展示：渲染符号 `✓○×!~`，光标高亮，pending 叠加 `~+`/`~-`。
- [ ] `MatrixScreen`：方向键移动光标、space toggle、a/d 行批量、enter 开 PlanReviewModal、r 刷新。
- [ ] `useInstallPlan`：对 pending 聚合 build install/uninstall plan，逐条 apply（hasConflict 跳过），完成后调 `refresh()`，回写 `lastResult`。
- [ ] `PlanReviewModal`：列 actions + 冲突项，y 应用 / n 返回。
- [ ] 组件测试（ink-testing-library）：渲染矩阵符号正确；模拟 space 产生 pending；模拟 enter + y 后矩阵状态变化（用临时 index fixture + mock service apply）。

验证：
```bash
pnpm test -- tui/screens/MatrixScreen tui/components
```

## Phase E. Discover 屏幕

文件：`screens/DiscoverScreen.tsx`、`hooks/useDiscover.ts`。

- [ ] 渲染 `listDiscover(index)`，kind badge + skill + path。
- [ ] a/i/u 触发 `adoptSkill` / `setIgnored`（ignore=true/false），完成后 refresh。
- [ ] enter：dispatch focusSkill + 切到 Matrix 屏。
- [ ] 组件测试：渲染条目；模拟 adopt 后列表刷新（mock）。

验证：
```bash
pnpm test -- tui/screens/DiscoverScreen
```

## Phase F. Doctor 屏幕

文件：`screens/DoctorScreen.tsx`、`hooks/useDoctor.ts`。

- [ ] 渲染 `runDoctor(...)`，带 fix 的项显 `[f]`。
- [ ] `useDoctor.applyFix(check)`：按 `fix.type` 调度 refresh-index / ensureDir(mkdir) / build+applyRepairPlan；完成后 refresh + 重跑 doctor。
- [ ] `f` 修单项、`F` 批量修所有 fixable（均过 PlanReviewModal 二次确认）。
- [ ] 组件测试：fixable 项渲染 `[f]`；模拟 f 后该项转 ok（mock applyFix）。

验证：
```bash
pnpm test -- tui/screens/DoctorScreen
```

## Phase G. CLI 接线 + skill search

文件：`src/cli/index.ts`。

- [ ] `asm tui`：懒加载 `import("../tui/App.js")` 启动；非 TTY 环境友好提示退出。
- [ ] `asm skill search <keyword>`：复用 `searchSkills`，表格输出（对齐现有 `skill list` 格式）。
- [ ] `src/tui/App.tsx`：装配 reducer + hooks + Layout 屏切换；启动加载 snapshot。

验证：
```bash
pnpm dev tui         # 手动冒烟（应进入 Matrix）
pnpm dev skill search react
```

## Phase H. 质量门 + 烟测

- [ ] `pnpm typecheck` 绿。
- [ ] `pnpm test` 全绿（含新 TUI/service 测试）。
- [ ] 临时 home 端到端：
```bash
ASM_HOME=/tmp/asm-tui-test pnpm dev init
ASM_HOME=/tmp/asm-tui-test pnpm dev refresh
# 手动：ASM_HOME=/tmp/asm-tui-test pnpm dev tui
#   Matrix 标记一个 install → enter → y → 矩阵变 ✓
#   Doctor 屏对一个 broken-link → f → 该项转 ok
#   Discover 屏 adopt 一个条目 → 列表刷新
ASM_HOME=/tmp/asm-tui-test pnpm dev doctor
```
- [ ] 确认无任何按键绕过 plan 直接改文件系统（代码审查 install/uninstall/repair 调用点均在 apply handler）。

## 风险点 / 回滚

- **Ink + ESM + NodeNext**：Ink 5 支持 ESM，但 tsx 运行 .tsx 需确认 jsx 配置生效。若 typecheck/运行报错，先单独验证一个最小 Ink 组件再铺开。
- **DoctorCheck 扩展破坏性**：仅内部消费，风险低；改动后跑全量 test 确认无遗漏断言。
- **apply 批量中途异常**：symlink 操作原子，且 plan 阶段已 conflict 过滤；仍需在 apply handler 包 try/catch，单条失败记录到 lastResult 不中断。
- **TUI 交互复杂度**：若 Matrix 状态机失控，回退为「Matrix 先只读 + 仅 CLI apply」，保留交互到下一轮（design 已列此回滚点）。
- **不碰真实 agent 目录**：所有集成测试用 `ASM_HOME`；禁止对 `~/.pi/agent/skills` 等真实路径写。

## task.py start 前检查

- [ ] 用户 review `prd.md` / `design.md` / `implement.md`。
- [ ] （若用 sub-agent 调度）`implement.jsonl` / `check.jsonl` 各含至少一条真实 spec/research 条目。
- [ ] `task.py start 07-02-tui-mvp` 仅在批准后执行。
