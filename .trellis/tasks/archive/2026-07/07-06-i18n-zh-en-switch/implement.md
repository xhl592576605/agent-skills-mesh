# Implement — 多语言中英文切换与布局适配

> 对应 `prd.md` / `design.md`。分 6 阶段，每阶段可独立验证与回滚。每阶段末是 review gate，全部通过后 `task.py start` 仍需用户确认。

## 通用验证命令

```bash
bun run typecheck     # tsc --noEmit，类型与字典完整性第一道关
bun run test          # vitest run，全量单测
bun run dev -- <args> # = bun run src/cli/index.ts <args>，手动冒烟
```

## Phase A — i18n 核心模块（零依赖，可独立验证）

**目标**：建好 `src/i18n/`，提供 `t()` / `resolveLanguage()` / `detectSystemLocale()` / `formatError()`，不改任何现有代码。

**改动**：
- 新增 `src/i18n/types.ts`（Locale / Params / TKey / Dict）
- 新增 `src/i18n/en.ts`（基准字典，先填已勘察到的 key：cmd descriptions / dialog titles / msg / err / help / tab / table，约 80–120 key）
- 新增 `src/i18n/zh-CN.ts`（中文字典，key 集合与 en 完全一致，按术语映射表翻译）
- 新增 `src/i18n/index.ts`（`t()` + 插值 + `resolveLanguage()` + `detectSystemLocale()` + `formatError()` helper）
- 新增 `tests/i18n.test.ts`：
  - 插值正确（`{{name}}` 替换）
  - zh-CN 缺 key 回退 en
  - en 缺 key 回退 key 字符串
  - **字典完整性**：`assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort())`（AC7 核心）
  - `resolveLanguage` 优先级链（explicit > config > locale > en）
  - `detectSystemLocale`：`LANG=zh_CN.UTF-8`→zh-CN，`LANG=en_US`→en，空→en
  - `formatError`：`bizError(code)` → t(err.code)，普通 Error → systemPrefix

**验证**：`bun run typecheck && bun run test`（新测试绿，旧测试不受影响——本阶段不改现有代码）。
**Review gate A**：字典 key 覆盖所有已勘察 UI 文本（对照 prd 的文本清单）；两份字典 key 一致。
**回滚**：删除 `src/i18n/` + `tests/i18n.test.ts`，零副作用。

## Phase B — core 错误码体系（Error + code 属性，非子类）

**目标**：core 层业务错误改为「Error 实例附加 code/params」抛出，不依赖 i18n，**不建 Error 子类**（符合 `backend/error-handling.md`，详见 design §5/§14）。

**改动**：
- 新增 `src/core/errors.ts`（`ErrorCode` 联合类型 + `bizError()` 工厂 + `isBizError()` 类型守卫，见 design §5.1）
- 改造 `src/core/services/install-service.ts`（`:73/78/94/138/162/180/196/198/219/221/222`）→ `throw bizError(...)`
- 改造 `src/core/services/ssot-service.ts:45` → `throw bizError(...)`
- 改造 `src/core/storage/config-store.ts:170` → `throw bizError(...)`
- 修 `tests/install-service.test.ts`：断言 `expect(isBizError(err)).toBe(true)` + `expect(err.code).toBe("SKILL_NOT_FOUND")`，替代原 `err.message` 含特定英文的断言
- 同步检查 `tests/source-service.test.ts` / `tests/agent-service.test.ts` / `tests/storage.test.ts` 是否有 message 断言需调整

**验证**：`bun run typecheck && bun run test`（所有 core 测试绿）。
**Review gate B**：所有 `throw new Error(英文业务消息)` 已替换为 `throw bizError(...)`；err.message 保留英文兜底；**未引入 Error 子类**（spec 合规，见 design §14）。
**回滚**：`bizError()` → `new Error()` 逐处还原；`errors.ts` 删除。

## Phase C — `config.language` 字段

**目标**：config 持久化语言偏好，向后兼容。

**改动**：
- `src/core/models/config.ts`：`settings` 加 `language: "auto" | "zh-CN" | "en"`
- `src/core/storage/config-store.ts`：
  - `createDefaultConfig()`：`settings.language = "auto"`
  - `serializeConfig()`：`[settings]` 段加 `language = ${quote(...)}`
  - `parseConfig()`：无需特判（既有 settings 分支自动收入；缺行保持默认 "auto"）
- 扩展 `tests/storage.test.ts`：round-trip `language` 字段；旧 config（无 language 行）解析得 `"auto"`

**验证**：`bun run typecheck && bun run test`。
**Review gate C**：旧 config.toml（无 language）解析不崩，默认 "auto"；新 config 正确读写 language。
**回滚**：移除 settings.language 字段 + 序列化行。

## Phase D — CLI 接入

**目标**：CLI `--lang` flag + `ASM_LANG` env，所有 console 消息走字典，错误走 `formatError`。

**改动**：
- `src/cli/index.ts`：
  - 顶层 `program.option("-L, --lang <lang>", "language: zh | en | auto")`
  - 封装 `resolveCliLang()`：`resolveLanguage({ explicit: opts.lang ?? process.env.ASM_LANG, config: (await readConfig()).settings.language })`，每个 action 首行调用
  - 所有 `console.log/error` 可见文本 → `t(key, lang, params)`
  - 表头 `["SKILL",...]` / `["SOURCE",...]` → `t()`
  - `:349` `console.error(err.message)` → `console.error(formatError(err, lang))`
- `src/cli/columns.ts` / `skill-format.ts`：表头/占位符在调用侧 t()
- 扩展 `tests/columns.test.ts`：列宽在中英文表头下的稳定性
- 可选：`tests/cli-i18n.test.ts` 冒烟（捕获 stdout 断言中文输出）

**风险（commander description 时机）**：`description()`/`option()` 在 parse 前（lang 未知）绑定，`--help` 双语需二次构建 command 树，复杂度高。**MVP 让 `--help` 文本保持英文**，只 i18n 运行时 console 输出与表头。AC8 中"`--help` description 双语"降级为"console 输出与表头双语"。若用户坚持 --help 双语，列为后续任务。

**验证**：
- `bun run typecheck && bun run test`
- 手动：`bun run dev -- init --force`（中文）、`ASM_LANG=en bun run dev -- refresh`（英文）、`bun run dev -- --lang zh doctor`、`bun run dev -- skill list`（表头中英对比）
**Review gate D**：中文模式下 CLI 输出无英文残留（除 --help 与系统错误原始 message）；优先级链四级各冒烟一次。
**回滚**：还原 console 调用与表头；移除 --lang option。

## Phase E — TUI 接入（热切换 + 布局适配）

**目标**：TUI 双语 + `shift+l` 键热切换，所有可见文本走 `useI18n().t`。

**改动**：
- 新增 `src/tui/context/i18n.tsx`（`I18nProvider` + `useI18n`，见 design §6.1；遵循 solid-patterns Owner Context 规则）
- `src/tui/App.tsx`：装配 `I18nProvider`；`TABS`/`TAB_HINTS`/`showHelp` 改用 `t()`；`AppShellKeyDeps` 加 `toggleLang`
- `src/tui/state/app-keys.ts`：弹窗判断后、view handler 前插 `if (key.name === "l" && key.shift) { deps.toggleLang(); return }`（**遵循 solid-patterns：key.name 恒小写，大写看 key.shift**）；扩展 `tests/tui/key-routing.test.ts` 断言 shift+l 触发 toggleLang 且不被搜索态/matrix 右移拦截
- `src/tui/index.tsx` `run()`：解析初始 Locale（flag > config），传入 `<I18nProvider initial={lang} configStore>`
- `src/tui/dialogs/*.tsx`（10 个）：标题/placeholder/按钮 label/message 改 `t()`
- `src/tui/views/*.tsx`（3 个）：`setMessage`/`ConfirmDialog`/`SelectDialog` 文本改 `t()`；`formatError(err, lang)` 包错误
- `src/tui/components/{Matrix,SearchBar,StatusBar,Inspector}.tsx`：可见文本改 `t()`
- 布局适配（design §8）：逐元素 zh/en 双渲染校验；SSOT/symlink 变长处确认不溢出

**验证**：
- `bun run typecheck && bun run test`
- 手动 TUI：`bun run dev -- tui --lang zh` → 全中文；按 `shift+l` → 即时切英文；再按 → 回中文；退出重启 `bun run dev -- tui`（无 --lang）→ 沿用上次 config 写入的语言
- 逐 tab（skill/source/doctor）+ 逐 dialog 目测双语完整、无溢出
**Review gate E**：中文模式 TUI 无英文残留；热切换即时生效且持久化；shift+l 在搜索态/弹窗态/matrix 右移场景行为符合预期（design §9）；布局双向无溢出。
**回滚**：还原各 tsx 文本调用；删除 i18n.tsx；app-keys 还原。

## Phase F — 字典完整性 + 全量回归 + spec 更新 + 收尾

**目标**：查漏补缺，确保无遗漏硬编码，全量绿，spec 同步。

**改动/检查**：
- **反向 grep 校验遗漏**：对 `src/cli`、`src/tui` 再跑一次用户可见文本提取（排除注释/符号/import），确认无未走 `t()` 的残留（对照 prd 文本清单 + design 改造表）
- 字典完整性测试再确认 en/zh key 集合同步（Phase E 可能新增 key）
- `bun run typecheck && bun run test` 全量绿
- **更新 spec**（design §14 要求）：`backend/error-handling.md` 增加「i18n 错误码约定」小节（`bizError()` / `isBizError()` + `ErrorCode` 列表 + 何时例外于"no custom hierarchies"），使错误码方案成为文档化约定；按需补 frontend 布局/key-routing 约定
- README 在「使用」章节补语言切换说明（`--lang` / `shift+l` 键 / `ASM_LANG` / config.language）——README 双语各更新

**验证**：
- 全量 typecheck + test 绿
- 反向 grep 无残留硬编码可见文本
- 手动冒烟 CLI + TUI 双语全路径
**Review gate F（最终）**：所有 AC1–AC8 满足；prd Acceptance 逐条勾选；error-handling spec 已更新。
**回滚**：本阶段主要是查漏 + spec 文档，无破坏性改动。

## 风险点汇总

| 风险 | 阶段 | 缓解 |
|---|---|---|
| 文本替换遗漏 | E/F | 反向 grep + 字典完整性测试 |
| commander description i18n 时机 | D | MVP 让 --help 保持英文，运行时输出双语 |
| 错误码改造破坏现有 message 断言 | B | Phase B 同步修测试，断言改 isBizError + code |
| solid 响应式未触发（t() 在非 reactive 上下文） | E | 热切换手动冒烟 + key-routing 测试 |
| shift+l 与 matrix hjkl 右移冲突 | E | design §9：toggleLang 前置优先级拦截，已分析无冲突 |
| SSOT/symlink 译后变长溢出 | E | design §8 矩阵逐项校验 |
| error-handling spec 合规性 | B/F | design §14：用 Error+属性非子类；Phase F 更新 spec 文档化 |

## 建议提交粒度

每 Phase 一个提交（A→B→C→D→E→F），便于 bisect 与回滚。Phase A/B/C 互相独立可并行编排，D 依赖 A，E 依赖 A+C，F 依赖全部。

## task.py start 前置检查

- [x] prd.md 已通过 convergence pass
- [x] design.md 存在且含契约/兼容性/trade-off/spec 合规性
- [x] implement.md 存在且含分阶段/验证/回滚
- [ ] implement.jsonl / check.jsonl 含真实 spec/research 条目（待 curate）
- [ ] 用户已审阅 prd/design/implement 并确认（**待用户 review**）
