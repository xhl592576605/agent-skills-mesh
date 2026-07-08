# Implement — TUI 样式重设计执行计划

## 前置

- [ ] P0.1 确认当前任务为 `.trellis/tasks/07-08-tui-style-redesign`。
- [ ] P0.2 阅读 frontend spec：component-guidelines、solid-patterns、state-management、quality-guidelines。
- [ ] P0.3 对照 `.trellis/images/{skill,source,fix}.png` 确认视觉目标。

## Phase 1 — Theme 与通用展示组件

- [ ] 1.1 扩展 `src/tui/theme/index.ts`，增加 panel/border/selection/keycap/cyan 等 token，保持旧 token 兼容。
- [ ] 1.2 新增 `src/tui/components/AppHeader.tsx`：产品名 + 右侧摘要。
- [ ] 1.3 新增 `src/tui/components/TabBar.tsx`：目标图风格 tab、active 下划线。
- [ ] 1.4 新增 `src/tui/components/Panel.tsx`：通用带边框容器。
- [ ] 1.5 改造 `src/tui/components/StatusBar.tsx` 或新增 `KeyHintBar`：把提示渲染为 keycap + label。

## Phase 2 — AppShell 总布局

- [ ] 2.1 修改 `src/tui/App.tsx`：使用 AppHeader + TabBar + 分隔线，删除内联旧 tab 样式。
- [ ] 2.2 在 AppShell 中从 `data.snapshot` 派生 summary（total/errors/warnings）。
- [ ] 2.3 保持 `createAppShellKeyHandler`、`tabHints`、DialogProvider、ViewKeyProvider 数据流不变。

## Phase 3 — Skill 视图视觉改造

- [ ] 3.1 改造 `SearchBar.tsx` 为目标图风格：边框、搜索提示、右侧 `/` keycap。
- [ ] 3.2 改造 `Matrix.tsx`：外层/表头/行样式、行号、选中行蓝色高亮、左侧 accent bar。
- [ ] 3.3 改造 `Inspector.tsx`：带边框 detail card、图标块、skill 摘要与 agent 状态。
- [ ] 3.4 调整 `SkillAgentView.tsx` 的 viewport 预留高度，适配新的 header/search/detail/footer 高度。

## Phase 4 — Source 视图视觉改造

- [ ] 4.1 改造 `SourceView.tsx` 表格为 bordered panel + 行号 + 选中条。
- [ ] 4.2 来源行显示路径与元信息；缺失字段不伪造。
- [ ] 4.3 增加/改造选中来源详情卡。
- [ ] 4.4 保持 `createSourceKeyHandler` 与 source service 调用不变。

## Phase 5 — Doctor 视图视觉改造

- [ ] 5.1 改造 `DoctorView.tsx` 表格为 bordered panel + 行号 + 状态图标/文字。
- [ ] 5.2 增加当前检查项详情/修复卡。
- [ ] 5.3 保持 `runDoctor`、`buildRepairPlan`、`applyRepairPlan` 调用不变。

## Phase 6 — 验证与收敛

- [ ] 6.1 运行 `pnpm typecheck`。
- [ ] 6.2 运行 `pnpm test`。
- [ ] 6.3 手动 smoke：`bun run src/cli/index.ts tui`，检查三 tab 可渲染、切换、退出。
- [ ] 6.4 对照三张图片做最终微调：header、tab、panel、selection、detail card、keycap。

## 回滚点

- 只触碰 `src/tui/**` 与任务文档，若样式改造出问题，可按组件粒度回滚。
- 不改 `src/core/**`，CLI 非 TUI 功能应天然不受影响。
