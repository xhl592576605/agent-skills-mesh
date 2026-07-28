# 集成 skills.sh 技能搜索与安装

## Goal

让用户无需预先手动添加 git 仓库，即可在 ASM TUI 中通过 skills.sh 发现 GitHub 技能，并把选中的技能纳入既有 source → SSOT skill → agent 分发生命周期。

## Background

- ASM 当前只能搜索用户已添加并 refresh 后形成的本地来源索引。
- 现有纳管流程是：添加 source → refresh → skill add 到 SSOT →按需 enable 到 agent。
- skills.sh 新版文档中的 `/api/v1/skills/search`、详情和审计接口要求 Vercel OIDC；匿名请求已验证返回 `401 authentication_required`。
- cc-switch 使用未写入新版文档的匿名公共端点 `GET https://skills.sh/api/search`；已独立验证可返回搜索结果。
- 该公共端点返回技能 `id`、`skillId`、`name`、`installs` 和 `source`，但已实测忽略 `offset`，`count` 也只是本次返回条数，不是目录总量。
- 该端点没有正式稳定性承诺，因此搜索不可用不得影响 ASM 现有手动 source 流程。

## Requirements

### R1 — TUI 远程发现

- MVP 仅提供 TUI 入口，不新增 CLI 搜索或安装命令。
- Source 视图提供 skills.sh 搜索快捷键；不新增第四个 tab，也不把远程候选混入仅展示已安装技能的 Skill×Agent 矩阵。
- 搜索弹窗在输入至少 2 个字符后实时请求，并避免连续输入产生无效请求或旧结果覆盖新结果。
- 每次获取相关性 Top 50，在弹窗内按每页 10 条做客户端分页；界面不得宣称这些结果等于全量目录。
- 每条结果至少展示技能名、GitHub 仓库、安装量和已安装状态。

### R2 — 来源范围

- MVP 仅展示并安装 `owner/repo` 形式的 GitHub 来源。
- well-known、域名或无法安全映射为 GitHub 仓库的结果不进入安装流程。
- skills.sh 只是发现服务，不成为 ASM 的第四层持久化模型。

### R3 — 单选安装语义

- 搜索结果采用单选安装，每次只处理一个 skill。
- 一次安装应完成：注册或复用对应 git source → 扫描来源 → 将选中 skill 加入 SSOT。
- 安装不得自动启用到任何 agent；用户后续在 Skill×Agent 矩阵显式选择分发范围。
- 同一 GitHub 仓库已注册时复用现有 source，不重复 clone。
- 同仓库后续安装其他 skill 时继续复用该 source，且每次只把选中项加入 SSOT。

### R4 — 冲突与安全

- 目标技能已存在于 SSOT 时阻止安装，不自动覆盖、重命名或 rebind。
- 安装前必须展示技能名、GitHub 仓库、安装量和“第三方结果不等于安全背书”的风险提示，并要求显式确认。
- MVP 不强制预览完整 `SKILL.md`，也不调用受保护的安全审计接口。
- 禁用或歧义 source、仓库中找不到目标 skill、同一 source 内目标歧义时均明确失败，不静默猜测或改变用户配置。

### R5 — 原子性与生命周期

- 若本次新建 source 后目标 skill 加入 SSOT 失败，回滚本次新增的 source 配置与 clone；安装前已存在的 source 不删除、不重置。
- 安装不得留下无 state 的 SSOT 半成品，也不得创建脱离 ASM 管理的额外技能副本。
- 成功安装必须能被现有列表、更新、移除、doctor 和 agent enable 流程识别。

### R6 — 失败与兼容

- skills.sh 使用固定官方公共端点，不要求用户配置 OIDC，不执行 `npx skills`。
- 超时、网络失败、非 2xx、无结果或响应结构变化必须显示明确反馈，并提示用户仍可手动添加 source。
- 不抓取网页、不静默切换接口，也不在 MVP 提供自定义 registry。
- 新增界面和错误信息保持中英文完整、跨平台一致，并且状态不能只依赖颜色表达。

## Acceptance Criteria

- [ ] AC1（R1）：Source 页可打开实时搜索弹窗；少于 2 个字符不请求，连续输入只展示最新查询结果。
- [ ] AC2（R1/R2）：结果按 Top 50、每页 10 条展示，只包含可安全映射的 GitHub 来源，并显示名称、仓库、安装量和已安装标记。
- [ ] AC3（R3/R4）：用户只能单选一个未安装技能；确认框完整展示元数据与第三方风险，取消时本地状态无变化。
- [ ] AC4（R3）：确认安装后，目标仓库被注册或复用，只有选中 skill 进入 SSOT，所有 agent 均保持未启用。
- [ ] AC5（R3）：同仓库第二个 skill 的安装不新增 source、不重复 clone，两个 skill 保留各自可更新的来源坐标。
- [ ] AC6（R4）：重复安装、同名 SSOT、禁用/歧义 source、目标缺失或候选歧义均被阻止，且不覆盖或猜测。
- [ ] AC7（R5）：新 source 安装任一中间步骤失败时回滚新增 config/clone/SSOT；复用 source 失败时既有 source 和既有 skill 完全保留。
- [ ] AC8（R5）：成功结果可被现有 skill list/update/remove/doctor/enable 流程识别，且不产生额外 unmanaged 副本。
- [ ] AC9（R6）：API 超时、HTTP/网络错误、非法响应和空结果均有中英文、颜色无关的明确反馈，并提示手动添加 source。
- [ ] AC10：新增行为具备隔离的自动化测试，`bun run typecheck` 与 `bun run test` 全部通过；TUI 变更额外通过 Bun 下的 TUI 测试。

## Out of Scope

- CLI 搜索/安装命令。
- skills.sh v1 OIDC 认证、详情、安全审计或完整内容预览。
- well-known/域名来源。
- 批量安装、自动启用 agent、自动覆盖/rebind/重命名。
- 自定义 registry、网页抓取或自动 fallback。
- 对本需求无关的 source/skill 模型重构与跨进程事务锁。
