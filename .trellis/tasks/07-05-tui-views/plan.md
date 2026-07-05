# 实现计划 — child-3（Source/Doctor 视图 + 全弹窗）

> prd: `07-05-tui-views/prd.md`，父 design: `07-05-tui-redesign/design.md`（§7 弹窗 / §9 CLI 映射 / §13 文件归属）。

## 复用契约（child-1/2 已建，勿重写）
- `useViewKey().setHandler(h)`：view 注册键 handler，返回 boolean（true=消费）。**view 不自注册 useKeyboard**。
- `useDialog()`：弹窗栈 `replace/closeTop/clear/isOpen`。
- `ConfirmDialog.show(dialog,title,message,opts?): Promise<boolean>`。
- `useData()`：`snapshot{config,index,state,loading,error}` + `refresh()`(重建 index，用旧 config/state) + `reload()`(重读 config/state/index)。
- StatusBar 接受 `hints` prop（数据驱动）。
- 弹窗内组件可用自己的 `useKeyboard`（opentui 无 stopPropagation，多订阅都收按键；AppShell 在 dialog.isOpen() 时只额外处理 ESC/ctrl+c 关栈顶）。
- store 创建：`new ConfigStore()` / `new IndexStore(configStore.home)` / `new StateStore(configStore.home)`。

## 写操作回写策略
- source/skill 写操作改 config.toml/state.json → 调 `await data.reload()` 再 `await data.refresh()`（reload 重读 config 让新 source 进 snapshot，refresh 用新 config 重建 index）。
- doctor repair 改 symlink（config/state 不变）→ `data.refresh()` 即可，但统一用 reload+refresh 保险。

## 新建文件（8）
1. `src/tui/dialogs/PromptDialog.tsx` — useKeyboard 字符收集（不依赖 `<input>` focus，规避 owner context 风险），`show(dialog,title,default?,placeholder?): Promise<string|undefined>`
2. `src/tui/dialogs/SelectDialog.tsx` — ↑↓ 移动 + enter 选，`show<T>(dialog,title,options): Promise<T|undefined>`
3. `src/tui/dialogs/AddSourceDialog.tsx` — 串联 target→branch(可选)→type(SelectDialog: auto/repo/folder/skill)，返回 `{target,branch?,type?}|undefined`
4. `src/tui/dialogs/SkillDetailDialog.tsx` — 只读展示（name/status/candidates/source/hash/enabled agents/installations），无交互键（ESC 由 AppShell 关）
5. `src/tui/state/source-keys.ts` — `createSourceKeyHandler(deps)` 纯逻辑（a/u/d/e/x/enter/↑↓），返回 boolean
6. `src/tui/views/SourceView.tsx` — source 列表 + 写操作链（addSource/sourceUpdate/removeSource+purge/setSourceEnabled）
7. `src/tui/views/DoctorView.tsx` — runDoctor checks 列表 + `f`/`F` 修复（buildRepairPlan/applyRepairPlan + DoctorFix 调度）
8. `tests/tui/source-keys.test.ts` — source key handler 纯逻辑断言（参考 matrix.test.ts 模式）

## 修改文件（1）
- `src/tui/App.tsx`：
  - import SourceView/DoctorView，`<Show when={tab==="source"/"doctor"}>` 接入
  - TAB_HINTS 补 source/doctor hints
  - 全局键加 `?` → showHelp（dialog.replace 渲染只读键位表 box，ESC 由 AppShell 关）

## core 零改动 ✓（只 import src/core/**）

## Doctor fix 调度（DoctorFix.type）
- `refresh-index` → `data.refresh()`
- `mkdir-agent-dir` → `fs.mkdir(targetPath, {recursive:true})`
- `repair-broken-link` → `buildRepairPlan(config,index,skillName,agentId,state)` + ConfirmDialog + `applyRepairPlan(plan)`
- 无 fix 的 check（orphan/external/source-missing non-fixable）→ 仅展示，`f` 提示无可修复项

## 验证
- `pnpm typecheck` 绿
- `pnpm test` 绿（含新 source-keys.test.ts）
- `bun run src/cli/index.ts --help` / `source list` / `doctor` / `skill search` 不变（CLI 兼容）
- `git diff --stat src/core` 空
