# TUI: SkillAgentView + Matrix（child-2 of tui-redesign）

> 父 task：`07-05-tui-redesign`（见 `prd.md` + `design.md`）。本 task 实施 `implement.md` 的 **Phase 3**。

## Goal

实现 SkillAgentView：skill×agent **Matrix 表格**（opentui），`[on]`/`[off]`/`[!]` 文字标签，fuzzy 搜索，批量行操作，写操作经 ConfirmDialog 确认。

## Dependencies

- **child-1（07-05-tui-infra）**：theme / context（data/dialog）/ ConfirmDialog / App 骨架

## Scope（父 design.md §6）

- `state/matrix.ts`：cursor signal + pending store（skillName→agentId→intent）
- `state/search.ts`：搜索词 signal
- `components/Matrix.tsx`：表格渲染（表头 + 行 + 单元格标签 + 光标高亮 + 滚动窗口）
- `components/SearchBar.tsx`：`/` 触发 fuzzy 过滤
- `components/Inspector.tsx`：选中 skill 详情（来源/hash/agents/pending）
- `components/StatusBar.tsx`：底部状态 + 动态快捷键提示
- `views/SkillAgentView.tsx`：装配 Matrix + Inspector + StatusBar + Search
- 交互：`↑↓←→` / `enter` toggle / `a` 行全装 / `d` 行全卸 / `/` 搜索
- 写操作链：pending → `enter` review → ConfirmDialog → `buildInstallPlan`/`buildUninstallPlan` + apply → refresh → setSnapshot

## Requirements

- R3 Matrix 表格化（父 R3）

## Acceptance Criteria

- [ ] Matrix 渲染 skill×agent，单元格 `[on]`/`[off]`/`—`/`[!]`（pending 时 `[+]`/`[-]`）
- [ ] `↑↓←→` 移动光标，`enter` toggle 当前格（写 pending）
- [ ] `a` 当前行全装，`d` 当前行全卸（写 pending）
- [ ] `/` 触发 fuzzy 搜索，实时过滤 skill 行
- [ ] 有 pending 时 `enter` 进 ConfirmDialog → 确认后 apply（复用 `buildInstallPlan`/`buildUninstallPlan`）→ refresh 回写 snapshot
- [ ] 技能多时可滚动（scrollOffset 窗口）
- [ ] 不依赖颜色：状态用文字标签冗余（AC7）

## Notes

- 复用 `buildAgentColumns` 投影逻辑（从旧 `Matrix.tsx` 移植，换 Solid 载体）。
- 单元格标签映射见父 design §6。
