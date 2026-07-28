# skills.sh 技能搜索与安装设计

## 1. 设计目标

在不改变 ASM 三层领域模型的前提下，把 skills.sh 作为远程“发现服务”接入 TUI：用户在 Source 页搜索 GitHub 技能，确认后由 Core 完成 source 注册/复用、扫描、SSOT 安装和索引刷新。

设计必须保证：

- skills.sh 不成为新的持久化层或 source 类型；安装成功后仍是普通 `git-repo` source。
- TUI 不直接拼接 clone、refresh、复制或回滚流程。
- 同名、歧义、禁用 source 和响应结构变化均显式失败，不猜测、不覆盖。
- 新建 source 的安装失败可补偿回滚；复用 source 永不删除或重置。
- 安装只进入 SSOT，不自动创建任何 agent symlink。

## 2. 范围与非目标

### 范围内

- Core：skills.sh 公共搜索客户端、严格响应解析、GitHub 来源规范化、安装 plan/apply 编排、事务补偿。
- TUI：Source 页 `/` 入口、实时防抖搜索弹窗、Top 50 客户端分页、元数据确认、安装结果反馈。
- i18n：中英文搜索、状态、确认、错误和帮助文案。
- 测试：API parser、安装生命周期/回滚、TUI 状态机、键路由、i18n。

### 非目标

- CLI 搜索或安装命令。
- skills.sh v1 OIDC 认证、详情或安全审计接口。
- well-known/域名来源。
- 批量安装、自动启用 agent、自动覆盖/rebind/重命名。
- 自定义 registry、网页抓取、静默 fallback。
- 完整跨进程事务锁。

## 3. 外部 API 契约

固定请求：

```text
GET https://skills.sh/api/search?q=<encoded-query>&limit=50
```

约束：

- trim 后查询词少于 2 个字符不发送请求。
- 请求超时固定为 10 秒；弹窗关闭或查询变化时通过 `AbortSignal` 取消。
- 不发送 OIDC Token，不执行 `npx skills`。
- `offset` 已实测被公共端点忽略，因此不发送、不把 `count` 当全量总数。
- `count` 仅作为响应一致性信息；本地分页以解析后的 Top 50 数组为准，每页 10 条。

原始响应只接受以下字段类型：

```ts
interface SkillsShRawResponse {
  query: string
  searchType: string
  skills: Array<{
    id: string
    skillId: string
    name: string
    installs: number
    source: string
  }>
  count: number
  duration_ms: number
}
```

JSON 非法、字段缺失或类型错误统一视为响应契约变化，返回可翻译的 typed error。只保留严格符合 `owner/repo` 的 GitHub 来源；域名、协议 URL、多段路径、`.`/`..`、反斜杠等均过滤。

Core 对外返回：

```ts
interface SkillsShSkillRef {
  provider: "skills.sh"
  id: string
  skillId: string
  name: string
  installs: number
  source: string
  repository: {
    owner: string
    repo: string
    key: string       // github:<lower-owner>/<lower-repo>
    cloneUrl: string  // Core 构造的固定 HTTPS URL
  }
}

interface SkillsShSearchResult {
  query: string
  searchType: string
  items: SkillsShSkillRef[]
  returnedCount: number
  durationMs: number
}
```

API 的任意 URL 都不进入 clone；clone URL 只能由通过校验的 `owner/repo` 在 Core 中构造。

## 4. Core 模块边界

### 4.1 `skills-sh-service.ts`

职责：

- 构造固定搜索 URL。
- 接收 `{ query, signal?, fetchImpl? }`，便于测试注入 fetch。
- 实现 10 秒超时，并区分主动 abort、timeout、HTTP 失败和 schema 失败。
- 严格解析响应并过滤非 GitHub 条目。
- 返回 typed 结果，不依赖 TUI、stores 或 i18n。

### 4.2 GitHub identity helper

提供纯函数：

```ts
parseSkillsShGitHubSource(source): GitHubRepoRef | undefined
parseGitHubRepoUrl(url): GitHubRepoRef | undefined
findCanonicalGitHubSources(config, key): SourceConfig[]
```

规范化 key 不区分 GitHub owner/repo 大小写，并识别 HTTPS、尾随 `.git`、GitHub SSH/scp 等已有配置形式。复用规则：

- 0 个：计划创建新 source。
- 1 个 enabled source：计划复用；不 pull、不切 branch、不改 URL/path。
- 1 个 disabled source：冲突，提示先显式启用。
- 多个 canonical 相同 source：冲突，不静默选取。

### 4.3 安装 plan/apply

新增 typed plan：

```ts
type SkillsShSourcePlan =
  | { action: "create"; cloneUrl: string }
  | { action: "reuse"; sourceId: string }

interface SkillsShInstallPlan {
  ref: SkillsShSkillRef
  source: SkillsShSourcePlan
  hasConflict: boolean
  conflictCode?: ErrorCode
}
```

`buildSkillsShInstallPlan(config, state, ref)` 无文件写入，完成：

- provider/source/skillId 的边界校验。
- `assertSafeSkillName(ref.skillId)`。
- SSOT 同名状态预检。
- canonical source create/reuse/disabled/ambiguous 判断。

TUI 在展示安装确认前构建 plan；冲突计划不允许 apply。确认文案展示技能名、仓库、安装量、source 将创建或复用，以及第三方风险提示。

`applySkillsShInstallPlan(stores, plan)` fresh-read config/state 并重新构建 plan，防止确认期间状态变化，然后执行：

1. create 时直接调用 `addRepoSource()`；不调用会触发孤儿自动 rebind 的通用 `addSource()`。
2. reuse 时只读取既有 source，不 pull、不 reset、不改 branch。
3. 用最新 config/state 调 `refreshIndex()`。
4. 在该 source 内按 `candidate.skillName === ref.skillId` 精确匹配，且必须恰好一个。
5. 调事务化 `skillAdd(..., { source: source.id })` 写 SSOT/state。
6. 重新 refresh 并写 `IndexStore`。
7. 返回 source action、installed record、索引是否更新及 warning。

禁止将 API `id` 与 ASM `candidate.id` 比较；API `name` 只用于展示，不能作为路径或模糊 fallback。

## 5. 安装事务与回滚

### 5.1 通用 `skillAdd` 局部事务修复

当前 `skillAdd` 可能在 SSOT 复制成功、state 写失败后留下无 state 的目录。将唯一 candidate 后的写入抽为事务 helper：

1. fresh-read config/state，复核 source、candidate origin 与路径 containment。
2. 检查 state 同名与 SSOT target，永不 replace。
3. 复制到 SSOT。
4. 创建 record 并原子写 state。
5. 第 4 步失败时，只删除本调用新建的 SSOT target；清理失败返回 rollback-incomplete 错误，包含残留路径。

原有 `skillAdd` 也复用该 helper，使普通手动添加获得相同一致性保证。

### 5.2 新 source ownership token

创建 source 后立即生成仅本次 apply 持有的 token：

```ts
interface CreatedRepoSourceToken {
  sourceId: string
  canonicalKey: string
  url: string
  path: string
}
```

candidate missing/ambiguous、refresh 失败、SSOT/state add 失败时：

- 只有 `action=create` 才执行补偿；`reuse` 永不删除。
- fresh-read config，并按 sourceId/type/canonical URL/path 完整核对 token。
- 先原子移除 config source 记录；配置写失败则保留 clone。
- 再校验 clone path 严格位于 `config.paths.repos` 下并删除；删除失败不能吞掉，报告残留路径。
- 不使用 `removeSource(..., { purge:true })`，避免误删同 source 的既有技能，也避免遗漏无 state 的 SSOT 残留。

SSOT/state 已提交后，不再回滚 source。最终 `IndexStore.write()` 失败时返回“安装成功但索引刷新失败”的 warning，保留 source/SSOT/state，并提示用户 `ctrl+r` 重试刷新。

## 6. TUI 设计

### 6.1 Source 页入口

- Source 页 `/` 打开 skills.sh 搜索；`a` 继续表示手动添加 source。
- `createSourceKeyHandler` 新增 `onDiscover`，仍由集中键路由派发；SourceView 不新增 `useKeyboard`。
- Source hints、Help 和空态文案增加 `/ skills.sh` 提示。

### 6.2 `SkillsShSearchDialog`

新增专用 Dialog，遵守 element factory + `show(): Promise<SkillsShSkillRef | undefined>` 模式。

交互：

- 可打印字符/paste：编辑 query。
- Backspace：删除字符。
- `↑/↓`：移动结果光标。
- `←/→`：Top 50 内本地上一页/下一页，每页 10 条。
- Enter：选择未安装项。
- Esc/ctrl+c：由 AppShell 关闭弹窗。

状态机：

```text
idle → debouncing → loading → ready | empty | error
```

- 300ms 防抖。
- query 变化立即清分页/光标并让旧请求失效。
- `AbortController + requestId` 双重防竞态；迟到响应不得覆盖新查询。
- loading 时禁用 Enter；输入仍可打断。
- 搜索结果用 `[ ]`、`[✓ 已安装]`、`[!]`、`[—]` 和明确文本表达状态，颜色只作辅助。
- `installed` 仅为展示快照；SourceView 构建 plan 和 Core apply 都再次校验。

分页只针对已获取的 Top 50，页脚显示“第 N/M 页 · Top 50 结果”，不显示虚假的全量总数。

### 6.3 确认与应用

流程：

```text
Source `/`
→ 搜索弹窗选择一个结果并关闭
→ buildSkillsShInstallPlan
→ ConfirmDialog 显示元数据、source action、风险提示
→ applySkillsShInstallPlan
→ data.reload()
→ Source 状态消息
```

先关闭搜索弹窗再打开 ConfirmDialog，避免 `replace()` 提前结束底层 Promise。取消确认后不安装；MVP 不保留搜索弹窗状态。

SourceView 只持有 busy/message UI 状态，不拼装 filesystem 步骤。成功和部分成功（索引 warning）均 full reload；失败显示可翻译错误，API 搜索错误额外提示可按 `a` 手动添加 source。

## 7. 错误契约

复用：

- `SKILL_ALREADY_INSTALLED`
- `SSOT_TARGET_EXISTS`
- `INVALID_SKILL_NAME`
- 现有 source/skill candidate 错误（适用时）

新增建议：

- `SKILLS_SH_QUERY_TOO_SHORT`
- `SKILLS_SH_UNAVAILABLE`（params.kind 区分 timeout/http/network）
- `SKILLS_SH_INVALID_RESPONSE`
- `SKILLS_SH_INVALID_GITHUB_SOURCE`
- `SKILLS_SH_SOURCE_DISABLED`
- `SKILLS_SH_SOURCE_AMBIGUOUS`
- `SKILLS_SH_CANDIDATE_NOT_FOUND`
- `SKILLS_SH_CANDIDATE_AMBIGUOUS`
- `SKILLS_SH_ROLLBACK_INCOMPLETE`

新增 ErrorCode 必须同步中英 `err.*` 字典。Core 仅抛 `bizError` 英文 fallback，不依赖 i18n。

## 8. 数据与兼容性

- 不修改 `AppConfig`、`StateFile`、`IndexFile` schema。
- 不新增 registry 配置或凭据存储。
- 安装结果与手动 git source + skill add 完全同构，现有 update/remove/doctor/enable 可直接识别。
- 旧配置中的 GitHub URL 通过 canonical identity 复用；若历史上存在重复 canonical source，则显式报歧义。
- disabled source 保留用户意图，不由远程安装自动启用。

## 9. 测试策略

### Core 搜索

- 正常响应与字段映射。
- query 长度、URL 编码、固定 limit=50、10 秒 timeout、AbortSignal。
- HTTP/network/timeout/非法 JSON/schema drift typed error。
- 非 GitHub、路径穿越、多段 source 过滤。
- 证明 `offset` 不属于客户端契约，`count` 不作为总数。

### Core 安装

- 首次创建 source，只安装选中 skill，不启用 agent。
- 同仓库第二个 skill 复用 source，不重复 clone。
- GitHub URL 变体 canonical 复用；重复 canonical source 报歧义。
- disabled source、同名已安装、candidate missing/ambiguous 均无副作用。
- API `name/id` 与本地 candidate id 不同，仍只按 `skillId` 精确匹配。
- 新 source 各阶段故障注入后 config/clone/SSOT/state 回滚。
- 复用 source 失败时既有 source/skills 保持不变。
- IndexStore 最终写失败保留已提交安装并返回 warning。
- 所有测试使用临时 ASM_HOME 和本地临时 git repo/mock clone，不访问真实用户目录或 GitHub。

### TUI

- `/` 键路由、hint/help。
- 2 字符阈值、300ms 防抖、乱序响应、abort/dispose。
- Top 50 每页 10 条的本地翻页与边界。
- 已安装文本标识及 Enter 阻止。
- Dialog Promise/取消语义、paste、loading/empty/error 状态。
- 确认后才 apply；成功/失败/索引 warning 后 reload 与消息。
- 中英 key、插值集合和风险文案完整。

## 10. 风险与回滚

- 公共端点未文档化：所有不稳定性限制在单一 client/parser；失败不影响本地已有功能。
- 公共端点不支持真实分页：只展示 Top 50 本地分页并明确边界。
- 网络搜索不会修改本地状态；只有用户选择并确认后才 apply。
- 若上线后端点失效，可移除/隐藏 Source `/` 入口与 skills.sh client，不需要迁移任何持久化数据；已安装技能仍是普通 git source，可继续更新和管理。
