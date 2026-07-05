# TUI: Source/Doctor 视图 + 全弹窗（child-3 of tui-redesign）

> 父 task：`07-05-tui-redesign`（见 `prd.md` + `design.md`）。本 task 实施 `implement.md` 的 **Phase 4**。

## Goal

实现 Source/Doctor 视图 + 全部弹窗，覆盖 CLI 全功能（除 `init`）。

## Dependencies

- **child-1（07-05-tui-infra）**：dialog 基础设施、状态、theme
- **child-2（07-05-tui-matrix）**：Matrix 共享组件、StatusBar、写操作链模式

## Scope（父 design.md §7/§9）

- `views/SourceView.tsx`：source 列表 + add/update/remove/enable/disable
- `views/DoctorView.tsx`：issues + adopt 候选 + `f` 修复
- `dialogs/AddSourceDialog.tsx`：target/branch/type 表单（复用 `addSource` 类型推断）
- `dialogs/SelectDialog.tsx`：通用选择（rebind source / skill-add 多源 / remove --purge）
- `dialogs/PromptDialog.tsx`：通用输入
- `dialogs/SkillDetailDialog.tsx`：skill info（对应 `skill info`）
- 全局快捷键：`r` refresh、`1`/`2`/`3` tab、`?` help

## Requirements

- R4 顶部 Tab（Source/Doctor 部分）
- R5 浮层弹窗（完整）
- R6 功能对齐 CLI

## Acceptance Criteria

- [ ] Source tab：`add`（AddSourceDialog 表单）、`update`、`remove`（ConfirmDialog + purge 选项）、`enable`/`disable` 全可用
- [ ] Doctor tab：显示 issues + 可 adopt 候选技能、`f` 修复（经确认）
- [ ] 所有写操作走浮层弹窗确认
- [ ] 全局 `r` refresh、`1`/`2`/`3` 切 tab、`?` help 弹窗
- [ ] 覆盖 CLI 全功能：`source add/update/remove/list/enable/disable`、`skill search/add/list/info/update/remove/rebind`、`refresh`、`doctor`
- [ ] 各操作经对应 core service（`addSource`/`sourceUpdate`/`removeSource`/`setSourceEnabled`/`runDoctor`/`buildRepairPlan` 等），不内联域逻辑

## Notes

- CLI→TUI 映射见父 design §9 表。
- `skill add`/`rebind` 用 SelectDialog 选 source；`remove --purge` 用 SelectDialog 选保留/级联。
