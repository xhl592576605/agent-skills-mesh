# Source 页 skills.sh 实时分页搜索弹窗：最小 TUI 设计研究

## 结论摘要

建议在 Source 页使用 **`/`** 打开一个新的专用 `SkillsShSearchDialog`：弹窗始终保持输入焦点，输入满 2 个字符后 300ms 防抖搜索，`↑/↓` 单选结果，`←/→` 翻页，`Enter` 选择，`Backspace` 编辑，`Esc` 取消。`a` 继续保留为手动添加来源。

不要串联 `PromptDialog -> SelectDialog`，也不要复用 `MultiSelectDialog`：前者会丢失实时输入/分页状态，后者违反单选要求。应沿用现有 Dialog 的 “内容组件 + `show(): Promise<T | undefined>` + element factory” 模式，新建专用弹窗；搜索结果选中后先关闭搜索弹窗，再由 `SourceView` 调现有 `ConfirmDialog.show()` 展示安装确认，随后调用 Core 的原子安装编排并 `data.reload()`。

## 1. 现有约束与入口证据

- PRD 明确要求入口位于 Source 视图、新快捷键、专用实时搜索弹窗、至少 2 字符、防抖、`limit/offset` 分页：`.trellis/tasks/07-28-skills-sh-discovery/prd.md:21-23`。
- 搜索结果必须单选：`.trellis/tasks/07-28-skills-sh-discovery/prd.md:26`。
- 安装后只进入 SSOT，不自动启用 agent：`.trellis/tasks/07-28-skills-sh-discovery/prd.md:28`。
- 已安装项要标记并阻止覆盖/rebind：`.trellis/tasks/07-28-skills-sh-discovery/prd.md:30`。
- 确认前必须展示技能名、GitHub 仓库、安装量、第三方风险：`.trellis/tasks/07-28-skills-sh-discovery/prd.md:34`。
- 网络/API 错误必须明确提示手动添加 source：`.trellis/tasks/07-28-skills-sh-discovery/prd.md:35`。

当前 Source 页：

- `SourceView` 通过 `createSourceKeyHandler` 注册 view handler，自身不调用 `useKeyboard`：`src/tui/views/SourceView.tsx:54-55,85-96`。
- 已有键位为 `a/u/d/e/x/Enter`：`src/tui/state/source-keys.ts:52-74`；未知键返回 `false` 给 AppShell：`src/tui/state/source-keys.ts:76-77`。
- `SourceView` 已有标准“弹窗 -> core service -> reload/refresh -> message”写操作形态：`src/tui/views/SourceView.tsx:100-118,131-157`。
- Source 页底部 hint 来自集中映射：`src/tui/state/tab-hints.ts:19-29`；AppShell 响应式翻译并注入 StatusBar：`src/tui/App.tsx:70-72`。

## 2. 建议快捷键

### Source 页

| 键 | 行为 | 理由 |
|---|---|---|
| `/` | 打开 skills.sh 搜索弹窗 | 与现有 Skill 页 `/` 搜索习惯一致；Source 页尚未占用；不会改变 `a` 的“手动添加来源”语义 |
| `a` | 保持手动添加 source | API 失败提示可直接引导用户按 `a` 降级 |

`source-keys.ts` 增加 `onDiscover`，在 `key.sequence === "/"`（或兼容 `key.name === "/"`）时消费并调用。现有全局键 `1/2/3`、`ctrl+r`、`?`、`Esc` 仍 fallthrough。

现有 Skill 搜索也是 `/` 进入：`src/tui/state/skill-agent-keys.ts:164-166`；输入态会吞普通字符：`src/tui/state/skill-agent-keys.ts:57-61`。Source 新入口复用用户心智，而不复用其本地过滤状态。

### 弹窗内

| 键 | 行为 |
|---|---|
| 可打印字符 / paste | 追加搜索词 |
| `Backspace` | 删除末尾字符 |
| `↑/↓` | 移动结果光标 |
| `←/→` | 上一页 / 下一页 |
| `Enter` | 选择当前未安装结果 |
| `Esc` / `ctrl+c` | 取消并关闭 |

不建议弹窗内支持 `j/k`、`h/l`、`n/p`：弹窗始终处于输入态，这些可打印字符必须进入查询词。箭头键没有该冲突。也不建议让 `ctrl+r` 刷新 App：Dialog 打开时 AppShell 会吞掉除关闭键之外的所有全局键，现有契约就是如此：`src/tui/state/app-keys.ts:51-53`、`tests/tui/key-routing.test.ts:45-64,207-211`。

## 3. 为什么需要专用弹窗

### 可复用部分

- **Dialog 基座/栈**：继续使用 `DialogProvider`；弹窗内容必须以 factory 保存并在 Provider owner 内创建：`src/tui/context/dialog.tsx:30-40,100-105`，规范证据 `.trellis/spec/frontend/component-guidelines.md:92-100`。
- **Prompt 输入约定**：复用末尾追加、Backspace、可打印 ASCII、`usePaste` 的行为：`src/tui/dialogs/PromptDialog.tsx:39-65`。规范明确输入弹窗应同时使用 `usePaste`，否则终端粘贴会丢失：`.trellis/spec/frontend/solid-patterns.md:164-166`。
- **Select 单选约定**：复用 `↑/↓`、`Enter`、选择光标 `❯` 的视觉/交互模式：`src/tui/dialogs/SelectDialog.tsx:60-90,105-115`。
- **Promise 约定**：先 `onConfirm(value)`，再 `dialog.clear()`，否则 onClose 的取消值可能抢先 settle：`src/tui/dialogs/SelectDialog.tsx:84-92`。

### 不应直接复用的部分

- `PromptDialog` 只维护单行 value，`Enter` 立即提交关闭；没有结果、cursor、loading/error、分页：`src/tui/dialogs/PromptDialog.tsx:39-58`。
- `SelectDialog` 的 options 是静态 props，只有选择状态，没有输入/请求/分页：`src/tui/dialogs/SelectDialog.tsx:43-75,105-115`。
- `MultiSelectDialog` 使用 checkbox/locked 集合和批量提交，明确是多选：`src/tui/dialogs/MultiSelectDialog.tsx:13-17,50-76,127-141`，与 PRD 单选冲突。
- `Dialog` 当前面板宽度固定 92，足以放 8～10 条紧凑结果；`size` prop 当前没有改变宽度，没必要为 MVP 修改基座：`src/tui/dialogs/Dialog.tsx:23,43-47`。

建议新增：

```text
src/tui/dialogs/SkillsShSearchDialog.tsx
src/tui/state/skills-sh-search.ts
```

其中 Dialog 只负责渲染/按键/paste；状态文件负责可测的 query、phase、cursor、offset、防抖与竞态控制。这样遵守“focused state + pure/testable key/state logic”：`.trellis/spec/frontend/directory-structure.md:77-81`。

## 4. 弹窗状态机

建议状态：

```ts
type SearchPhase =
  | "idle"       // 初始，提示至少 2 字符
  | "debouncing" // 已满 2 字符，等待 300ms
  | "loading"    // 请求中
  | "ready"      // 有可展示结果
  | "empty"      // API 无结果，或当前页无支持的 GitHub 结果
  | "error"      // 超时/非 2xx/结构变化
```

另有正交状态：`query`、`requestQuery`、`offset`、`limit`、`total`、`results`、`cursor`、`requestId`、`notice`。

### 转移

1. **打开**：`idle`，query 空，offset/cursor 为 0，显示“输入至少 2 个字符”。
2. **query 变化且 trim 后 < 2**：清 debounce、abort 在途请求、递增 requestId、清结果/total、offset/cursor 归 0，回 `idle`。
3. **query 变化且 >= 2**：立即使旧请求失效、offset/cursor 归 0、清旧结果，进入 `debouncing`；300ms 后请求 `(normalizedQuery, limit, 0)`。
4. **请求开始**：`loading`；期间吞 `Enter/←/→`，避免对旧页操作。输入和 Backspace 仍可打断请求。
5. **成功**：写入与当前 requestId 匹配的结果/total；有可展示 GitHub 项为 `ready`，否则 `empty`。
6. **失败**：只有当前 requestId 可写 `error`；错误文案必须包含“可按 a 手动添加来源”。Abort 不展示错误。
7. **上下移动**：只改 cursor，clamp 在 `[0, results.length-1]`；results 变化时 cursor 归 0。
8. **翻页**：同一 query 下 `←/→` 立即请求，无需再次 debounce；进入 `loading`。
9. **Enter 已安装项**：不关闭，写 `notice = 已安装，不能覆盖/重命名/rebind`。
10. **Enter 未安装项**：先 resolve 选中结果，再清 dialog；后续确认/安装由 SourceView 处理。
11. **关闭/unmount**：clear timer、abort controller、递增 requestId，禁止迟到 Promise 写已卸载状态。

搜索 query 属于 view-local/pending UI 状态，不应持久化：`.trellis/spec/frontend/state-management.md:32-36`；domain/API 解析和安装编排必须留在 Core，TUI 只消费 typed service output：`.trellis/spec/frontend/directory-structure.md:73-75`、`.trellis/spec/frontend/solid-patterns.md:47-48`。

## 5. 防抖、竞态和取消

建议 **300ms** 防抖（250～300ms 均可，MVP 固定常量即可）。必须同时使用两层保护：

1. `AbortController`：新 query、新页、关闭弹窗时 abort 上一个请求；Core 搜索 service 接受可选 `AbortSignal`。
2. 单调递增 `requestId`：每次 query 变化时立刻递增；请求完成后只有 `id === currentRequestId` 才能写 state。即使底层 fetch/mock 不响应 abort，旧响应也不能覆盖新查询。

关键点是 **query 一变化就失效旧请求**，不能等新 debounce 到期才递增；否则旧请求可能在 300ms 等待窗内回写旧结果。

建议测试竞态：

- `ab` 发起请求 A，输入变为 `abc` 后请求 B；B 先完成、A 后完成，最终只显示 B。
- 输入从 `ab` 删除到 `a`，A 即使完成也不能回写。
- 翻到下一页后上一页响应迟到，不能覆盖下一页。
- 关闭弹窗后 deferred Promise resolve，不产生状态写入或 unhandled rejection。

## 6. 分页语义

建议 `limit = 8` 或 `10`，固定在 UI/Core 常量中；`offset` 为 0-based：

- `page = floor(offset / limit) + 1`
- `hasPrev = offset > 0`
- `hasNext = offset + limit < count`
- prev offset：`max(0, offset - limit)`
- next offset：`offset + limit`

**不能用 `results.length` 判断下一页**。MVP 要过滤非 `owner/repo` 来源，某一 API 页可能 raw count > 0 但过滤后当前页为空；仍应允许用户按 `→` 去下一 API 页。Core typed response 应保留 raw `count`、本次 `offset/limit` 或直接提供 `hasNext/nextOffset`，TUI 不应自行解析原始 API payload。

`DataTable` 已支持 `{offset,count}` viewport 和 cursor：`src/tui/components/DataTable.tsx:52-62,80-87`，但它会再包一层 Panel，专用弹窗内手写紧凑列表更小。可以复用其“光标由调用方持有、颜色只是辅助”的思想：`src/tui/components/DataTable.tsx:14-15,149-164`。

分页 footer 示例：

```text
↑↓ 选择 · ←/→ 翻页 · enter 安装 · backspace 编辑 · esc 取消   第 2 页 · 共 37 条
```

当前页无 GitHub 结果但仍有下一页时显示：

```text
[—] 本页没有支持的 GitHub 技能；按 → 查看下一页
```

## 7. 安装确认流程

最小且兼容现有 Dialog 栈语义的流程：

```text
Source `/`
→ SkillsShSearchDialog.show()
→ 用户 Enter，搜索弹窗 resolve(result) 并 clear
→ SourceView 重新检查当前 SSOT 是否已有同名技能
→ ConfirmDialog.show()
→ Core installDiscoveredSkill(result)
→ data.reload()
→ Source 页状态消息
```

确认 message 必须逐行显示：

```text
技能：<name>
GitHub：<owner/repo>
安装量：<formatted installs>
[!] 第三方技能风险：ASM 不保证其内容安全；确认后将注册/复用来源并复制该技能到 SSOT。
```

按钮使用“取消 / 安装”，不使用笼统“确认”。现有 ConfirmDialog 支持多行 message 和自定义 label：`src/tui/dialogs/ConfirmDialog.tsx:21-27,65,97-113`。

不建议在搜索弹窗仍存活时直接调用 `ConfirmDialog.show()`：`show()` 使用 `dialog.replace`，会触发旧弹窗 onClose 并终止其 Promise：`src/tui/context/dialog.tsx:48-51`、`tests/tui/dialog.test.ts:52-57,223-229`。虽然 stack 有 `push`，现有 ConfirmDialog commit 会 `dialog.clear()`，不是 `closeTop()`；为了 MVP 不应扩展成嵌套确认。代价是用户取消确认后需重新打开搜索，但实现和取消语义最可靠。

安装期间 `SourceView` 增加 `installingRemote` busy guard，防止确认关闭后重复触发；状态行显示 `⠋ 正在安装 <name>...`。成功后必须 `data.reload()` 读取完整 config/index/state，因为注册 source 会修改 config：`.trellis/spec/frontend/state-management.md:85-90,110-111`。回滚、新旧 source 复用、refresh、只加目标 skill 等均由 Core 原子 service 负责，不能放进组件；规范要求 filesystem mutation 经 core + confirm + reload：`.trellis/spec/frontend/directory-structure.md:82-84`。

## 8. 颜色无关状态设计

主题规范明确颜色只能辅助，状态必须有文本/符号：`src/tui/theme/index.ts:6-13`、`.trellis/spec/frontend/quality-guidelines.md:49,131`。

建议每种状态都有固定文字/符号：

| 状态 | 无颜色也可识别的呈现 |
|---|---|
| 当前行 | `❯` 前缀（颜色高亮仅辅助） |
| 可安装 | `[ ] <skill>` |
| 已安装/阻止 | `[✓ 已安装] <skill>`；Enter 后显示“已安装，不能覆盖” |
| 等待输入 | `[i] 请输入至少 2 个字符` |
| 防抖/请求中 | `⠋ 正在搜索 skills.sh...` |
| 无结果 | `[—] 没有结果` |
| 当前页过滤为空 | `[—] 本页没有支持的 GitHub 结果`，并保留下一页提示 |
| 网络/API 错误 | `[!] 搜索失败：<原因>；可按 a 手动添加来源` |
| 第三方确认 | `[!] 第三方技能风险：...` |
| 页码 | `第 N 页 · 共 count 条` |

每条结果至少显示：skill name、`owner/repo`、`↓ installs`、`[✓ 已安装]`（如适用）。不要只把已安装项染灰；现有 MultiSelect 已使用 `[✓]` 文本锁定标记，可作为直接先例：`src/tui/dialogs/MultiSelectDialog.tsx:13,26-28,127-140`。

## 9. i18n 变更

建议新增统一 namespace（示例 `skillsSh.*`）：

- `skillsSh.title`
- `skillsSh.placeholder`
- `skillsSh.minChars`
- `skillsSh.debouncing`
- `skillsSh.searching`
- `skillsSh.noResults`
- `skillsSh.noGithubOnPage`
- `skillsSh.page`
- `skillsSh.footer`
- `skillsSh.installs`
- `skillsSh.installed`
- `skillsSh.alreadyInstalled`
- `skillsSh.searchFailedManual`
- `skillsSh.confirmTitle`
- `skillsSh.confirmMessage`
- `skillsSh.riskWarning`
- `skillsSh.installing`
- `skillsSh.installOk`
- `skillsSh.installFailed`
- `hint.discover`（`/ skills.sh` 或 `/ 发现`）

同时更新 `help.sourceLine` 和可选的 `sourceView.noSources`，让无来源用户也知道 `/` 入口。当前英中帮助只列 `a/u/d/e/x/enter`：`src/i18n/en.ts:133`、`src/i18n/zh-CN.ts:132`；空列表也只提示 `a`：`src/i18n/en.ts:321`、`src/i18n/zh-CN.ts:316`。

`TKey` 从英文基准字典反推，中文 `Dict` 强制完整：`src/i18n/types.ts:16-22`。现有测试还校验英中 key、插值集合和非空值完全一致：`tests/i18n.test.ts:90-117`。

## 10. 集中键路由注意事项

- Source 页只扩展纯 `createSourceKeyHandler`，不得在 `SourceView` 新增 `useKeyboard`。规范要求 view 通过 `useViewKey` 注册：`.trellis/spec/frontend/solid-patterns.md:72-76,89-93`。
- 专用 Dialog 内容可像 Prompt/Select 一样使用自己的 `useKeyboard`。AppShell 仍收到事件，但 `dialog.isOpen()` 时会吞全局分支，active dialog 的 handler 处理具体键：`.trellis/spec/frontend/solid-patterns.md:75-76`。
- `Esc/ctrl+c` 由 AppShell `closeTop()`；Dialog handler 对这两个键直接 return，避免双重关闭。
- `useTheme/useI18n/useDialog` 必须在组件体捕获，不能在 timer、Promise continuation 或 keyboard callback 内重新调用，避免 owner 丢失：`.trellis/spec/frontend/solid-patterns.md:98-103,151-152`。
- 弹窗 unmount 时必须 `onCleanup` 清 timer/abort；现有规范把副作用清理绑定组件生命周期：`.trellis/spec/frontend/solid-patterns.md:35-37`。
- 不要给全屏遮罩加半透明背景，OpenTUI 0.4.x 会破坏 CJK 宽字符：`.trellis/spec/frontend/solid-patterns.md:167-169`；现有 Dialog 已明确透明 mask：`src/tui/dialogs/Dialog.tsx:9-12`。

## 11. 最小修改文件清单

### 必改 TUI

1. `src/tui/views/SourceView.tsx`
   - 注入 `onDiscover`；实现搜索 -> 重名复核 -> 确认 -> Core 安装 -> `data.reload()` -> message。
   - 增加 `installingRemote` busy/status。
2. `src/tui/state/source-keys.ts`
   - `SourceKeyDeps.onDiscover`；`/` 消费分支。
3. `src/tui/dialogs/SkillsShSearchDialog.tsx`（新增）
   - 输入、paste、结果列表、单选、分页、状态文案、`show()` Promise。
4. `src/tui/state/skills-sh-search.ts`（新增）
   - 可测试的 phase/query/cursor/offset/controller；防抖、abort、requestId、dispose。
5. `src/tui/state/tab-hints.ts`
   - Source hints 加 `hint.discover`。
6. `src/i18n/en.ts`
7. `src/i18n/zh-CN.ts`
   - 完整 skills.sh 文案、hint、帮助/空态更新。

### 不需要为 MVP 修改

- `src/tui/App.tsx`：已有 Source tab、help key 和 tab-hints 注入，改字典即可生效：`src/tui/App.tsx:72,116-117,164-166`。
- `src/tui/dialogs/Dialog.tsx`：92 列宽足够，且透明遮罩契约应保持。
- `PromptDialog.tsx` / `SelectDialog.tsx` / `MultiSelectDialog.tsx`：只作为交互模式参考，不应硬扩展成远程搜索。
- `ConfirmDialog.tsx`：现有多行 message + 自定义按钮足够。若未来要求风险操作默认落在“取消”，可单独增加 `defaultChoice`，但不是本 MVP 必需。

### Core 前置依赖（本研究不展开实现）

TUI 应只 import typed Core API，例如：

- `searchSkillsSh({query, limit, offset, signal})`
- `installDiscoveredSkill(configStore, stateStore, result)`

原始 fetch、响应结构校验、GitHub source 过滤、URL 规范化、source 复用、refresh、目标 skill 定位、失败回滚都必须在 Core；否则违反 Core/TUI 解耦和可测试性要求：`.trellis/tasks/07-28-skills-sh-discovery/prd.md:21`、`.trellis/spec/frontend/directory-structure.md:73-75`。

## 12. 测试建议

### 扩展现有测试

1. `tests/tui/source-keys.test.ts`
   - `/` 调 `onDiscover` 且返回 true。
   - `/` 不触发 `onAdd`。
   - 原有 `1/2/3/ctrl+r/esc/?` 继续 fallthrough。
   - 当前该测试已覆盖 add/update/detail/fallthrough/clamp：`tests/tui/source-keys.test.ts:74-116,118-151,172-178`。

2. `tests/tui/tab-hints.test.ts`
   - `source` 包含 `hint.discover`；当前只断言 `hint.add`：`tests/tui/tab-hints.test.ts:10-12`。

3. `tests/tui/dialog.test.ts`
   - `SkillsShSearchDialog.show()` 注册 element/onClose；closeTop/遮罩 resolve `undefined`。
   - 保持现有取消 Promise 语义先例：`tests/tui/dialog.test.ts:215-219,249-253,270-274,283-291`。

4. `tests/i18n.test.ts`
   - 现有完整性测试自动覆盖新英中 key/placeholder；可额外断言风险文案包含 `[!]` 或明确“第三方”。

### 新增纯逻辑测试

`tests/tui/skills-sh-search.test.ts`：

- `<2` 字符不请求；第 2 字符后 299ms 不请求、300ms 请求一次。
- 连续输入只请求最后 query。
- query 改变立即清 results、offset/cursor 并使旧请求失效。
- A/B 乱序响应只接受最新 requestId。
- Abort 不进入 error；超时/非 2xx/结构错误进入 error 并有手动添加提示 key。
- 上下移动 clamp；空结果 Enter 无动作。
- 已安装结果 Enter 被阻止并产生 notice。
- prev/next 边界；新 query 重置 offset；翻页不走 debounce。
- “当前支持结果为空但 raw count 还有下一页”仍 `hasNext=true`。
- dispose 后 timer 不触发、迟到 Promise 不写 state。

测试应用 fake timers + deferred Promise，避免真实网络和 OpenTUI FFI。

### Renderer 测试

可选在 `tests/tui/render-smoke.test.tsx` 增加最小弹窗 frame 断言（输入提示、`[✓ 已安装]`、错误 `[!]`、页码），但必须继续用 native probe + `describe.skipIf(!nativeOk)`；现有 renderer 测试在多数 node worker 会跳过：`tests/tui/render-smoke.test.tsx:15-27,37-39`。关键行为应由纯状态/键测试兜底，符合质量规范的两层测试策略：`.trellis/spec/frontend/quality-guidelines.md:64-88`。

## 13. 主要风险/取舍

1. **过滤后空页**：必须按 raw `count/offset/limit` 翻页，不能按过滤后的 results 长度判断。
2. **搜索确认取消后丢查询**：MVP 采用“先关闭搜索，再 ConfirmDialog”以保持现有栈语义；取消后需重新搜索。若要返回原结果，需要新增支持 `closeTop` 的嵌套确认，不应混入 MVP。
3. **迟到响应覆盖**：仅 AbortController 不够；requestId 是必须的兜底。
4. **重复安装竞态**：搜索时的 `[✓]` 只是提示；选择后和 Core apply 时都要再次校验 SSOT 重名，TUI 不可把 UI 标记当真相。
5. **状态只靠颜色**：所有状态必须有 `[✓]/[!]/[—]/⠋/文字`；灰色或红色仅辅助。
6. **弹窗输入键冲突**：不要支持 vim 字母导航；箭头专用于选择/翻页，字母全部进入 query。
