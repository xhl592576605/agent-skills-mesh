# skills.sh 技能搜索与安装实施计划

## 0. 开始前检查

- [ ] 确认用户已审阅 `prd.md` 与 `design.md`。
- [ ] 运行 `git status --short`，保留并避开用户现有 `AGENTS.md` 改动。
- [ ] 加载 backend/frontend spec 与两份 research；实现期间不得修改真实 `~/.agent-skills-mesh` 或 agent skills 目录。
- [ ] 所有集成测试使用临时 ASM_HOME、本地临时 git repo 或注入 fetch/git 行为。

## 1. Core 搜索契约

- [ ] 新增 skills.sh typed model（可放在 `skills-sh-service.ts` 或领域模型文件），定义 raw parser 与对外 `SkillsShSkillRef/SearchResult`。
- [ ] 实现严格 `owner/repo` parser 和 GitHub canonical identity；clone URL 只能由 Core 构造。
- [ ] 实现固定 `/api/search?q=...&limit=50` 客户端：2 字符阈值、10 秒 timeout、AbortSignal、HTTP/network/schema typed error。
- [ ] 明确忽略公共响应的伪分页信息：不发送 offset、不把 count 当总量。
- [ ] 先写/补 `tests/skills-sh-service.test.ts`：正常映射、过滤、编码、abort、timeout、HTTP/非法响应、无结果。

**验证点**：搜索 service 不 import TUI/i18n/stores，不做本地写入，不访问真实网络测试。

## 2. Source identity 与安装 plan

- [ ] 实现已有 GitHub source 的 canonical 匹配，覆盖 HTTPS、`.git`、SSH/scp 与大小写变体。
- [ ] 定义 `SkillsShInstallPlan` 及无副作用 `buildSkillsShInstallPlan(config, state, ref)`。
- [ ] 计划阶段检查 unsafe skillId、已安装、disabled source、canonical source 歧义，并给出 create/reuse action。
- [ ] 为新增业务分支补 `ErrorCode` 与中英文 `err.*` 字典；尽量复用现有 error code。
- [ ] 补 plan 单测，证明冲突在 clone 前被拒绝且 config/state 不变。

**验证点**：plan builder 只读；不 clone、不 refresh、不改 enabled/branch/path。

## 3. 修复 `skillAdd` 局部事务

- [ ] 抽取唯一 candidate 写入 helper，保留 `skillAdd` 现有公开语义。
- [ ] fresh-read 并复核 source/origin/path containment；SSOT 永不 replace。
- [ ] SSOT 复制后 record/state 写失败时只清理由本次调用新建的 target。
- [ ] 清理失败返回 rollback-incomplete，保留原始错误与残留路径。
- [ ] 扩展 `tests/skill-service.test.ts`：state 写失败清理、预存 SSOT 不覆盖、普通 skill add 回归。

**回滚点**：若该抽取改变现有 `skillAdd` 成功路径或测试语义，恢复原接口结构，只保留最小补偿 wrapper；不得降低原有冲突保护。

## 4. 安装 apply 与严格补偿

- [ ] 实现 `applySkillsShInstallPlan`：fresh rebuild plan → create/reuse source → refresh → 精确 candidate → transactional skillAdd → final index refresh。
- [ ] create 直接复用 `addRepoSource()`，不调用会自动 rebind 孤儿的 `addSource()`。
- [ ] candidate 只按该 source 下 `skillName === skillId` 精确匹配；0/多结果显式失败，不用 API name、目录 basename 或模糊 fallback。
- [ ] 为新 source 生成 ownership token，并实现 sourceId/type/canonical URL/path + repos containment 的严格 rollback。
- [ ] 对 reused source 的任意失败禁止删除、pull、reset、切 branch 或重新 enable。
- [ ] final IndexStore 写失败时保留已提交 source/SSOT/state，返回 warning 提示 refresh。
- [ ] 新增 `tests/skills-sh-install-service.test.ts`：首次安装、同仓库第二 skill、URL 变体复用、disabled/ambiguous/missing candidate、全阶段故障注入、复用 source 保护、最终 index warning、enabledAgents 为空。

**验证点**：每个故障测试断言 config、clone、SSOT、state 与既有 source 的精确最终状态；不得只断言抛错。

## 5. TUI 搜索状态与弹窗

- [ ] 新增纯状态模块 `src/tui/state/skills-sh-search.ts`：idle/debouncing/loading/ready/empty/error、300ms debounce、requestId、abort/dispose、Top 50 本地 10 条分页、cursor clamp。
- [ ] 新增 `SkillsShSearchDialog.tsx`，复用 Dialog element factory/Promise 约定，支持输入、Backspace、paste、箭头选择/翻页、Enter 单选、Esc 取消。
- [ ] 用 `[ ]`、`[✓ 已安装]`、`[!]`、`[—]` 和文本表达状态；颜色仅辅助。
- [ ] 页脚明确“Top 50 / 第 N/M 页”，不显示虚假目录总量。
- [ ] 新增 `tests/tui/skills-sh-search.test.ts`：阈值、防抖、乱序、abort、dispose、翻页、已安装阻止、空/错状态。
- [ ] 扩展 Dialog Promise 测试；renderer smoke 仅在 native probe 可用时运行。

**验证点**：旧请求不能覆盖新查询；弹窗关闭后不写状态、不产生 unhandled rejection；粘贴可用。

## 6. SourceView 接线与 i18n

- [ ] `source-keys.ts` 增加 `/` → `onDiscover`；更新纯键路由测试。
- [ ] SourceView 串联：搜索结果 → build plan → 元数据/风险 ConfirmDialog → apply → full `data.reload()` → 成功/失败/warning 消息。
- [ ] 安装 busy guard 防止重复触发；TUI 不自行操作 config/clone/SSOT。
- [ ] 更新 Source tab hint、Help、无来源空态和 `skillsSh.*` 中英字典。
- [ ] 更新 i18n 完整性、插值、source hints/help 测试。
- [ ] 确认取消后无写入；成功后矩阵可看到新 SSOT skill，但所有 agent cell 仍为 off。

**验证点**：SourceView 不新增 view 级 `useKeyboard`；Dialog 内输入键不触发全局 tab/refresh；写操作保持 confirm → core apply → reload。

## 7. 用户文档与回归

- [ ] 更新 `README.md` 与 `README.en.md`：Source 页 `/` 搜索、Top 50 边界、仅 GitHub、安装只进入 SSOT、手动 source fallback。
- [ ] 确认 CLI help 和现有 CLI 命令没有新增/改变。
- [ ] 检查未引入 OIDC token、registry 配置、HTTP server、数据库或 `npx skills` 依赖。

## 8. 验证命令

按顺序运行：

```bash
bun run typecheck
bun run test
bun run vitest run tests/tui/
```

建议补充定向迭代命令：

```bash
bun run vitest run tests/skills-sh-service.test.ts
bun run vitest run tests/skills-sh-install-service.test.ts
bun run vitest run tests/skill-service.test.ts
bun run vitest run tests/tui/skills-sh-search.test.ts tests/tui/source-keys.test.ts tests/i18n.test.ts
```

若本地支持交互 TTY，再以临时 ASM_HOME 手工 smoke：

- Source 页 `/` 输入查询、快速修改关键词、翻页、取消。
- 已安装项文本标记与阻止。
- 选择未安装项后确认/取消。
- API 失败时提示 `a` 手动添加。
- 安装成功后 source 出现、skill 进入 SSOT、agent 未启用。

## 9. 最终审查门

- [ ] 对照 `prd.md` AC1–AC10 逐项给出测试或代码证据。
- [ ] backend：路径 containment、同名保护、source ownership token、rollback incomplete 均有测试。
- [ ] frontend：颜色无关、Dialog 取消模型、集中键路由、防抖竞态均有测试。
- [ ] 跨层：API ref → plan → source → candidate → SSOT/state → index → TUI reload 数据流完整。
- [ ] `git diff` 无无关改动，且未覆盖用户已有 `AGENTS.md` 修改。

## 10. 整体回滚策略

- 功能没有 schema migration；若需撤回，只移除 Source `/` 入口、skills.sh client/install service 和对应 i18n/tests/docs。
- 已通过该功能安装的内容是普通 `git-repo` source + SSOT skill，不应随功能回滚删除，仍可用现有 update/remove/enable 管理。
- 未经用户明确要求，不执行 git commit 或 push。
