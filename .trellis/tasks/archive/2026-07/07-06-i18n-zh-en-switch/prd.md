# 多语言中英文切换与布局适配

## Goal

为 Agent Skills Mesh 的 CLI 与 TUI 增加中英文（zh-CN / en）双语支持，支持运行时热切换 + 多通道配置，并适配翻译后文本长度变化对布局（help bar、tab、dialog、表格列宽）的影响。

**用户价值**：中文用户获得母语界面（系统 locale 自动识别），英文用户维持现状；同一工具两种语言无缝切换，运行时即时生效。

## Background（代码勘察确认的事实）

### 现状：UI 几乎完全英文，无 i18n 基础设施

- **TUI**：help bar、tab 标签、dialog 标题/消息/按钮、状态提示全部英文。
  - help bar：`src/tui/App.tsx:130` `"↑↓←→/hjkl move · enter toggle · a row-on · d delete · r review · i info · m agents · / search"`；`:128/132/134` 其余三 tab 的 help。
  - tab：`src/tui/App.tsx:17-20` `{ key: "skill", label: "1 Skill×Agent" }` 等。
  - dialog：`"Add agent — id"`、`"Delete skill?"`、`"Apply pending changes?"`、`"Loading..."`、`"no source selected"` 等。
- **CLI**：commander `description`/`option`、`console.log/error` 消息、表头全部英文。
  - `src/cli/index.ts:27/41/51/64/85/230/249/258/270` 各 command description；`:36/46/92-94/129-130/345` 成功消息；`:67` 错误消息；`:242/116` 表头 `["SKILL","STATUS","DETAIL"]` / `["SOURCE","ACTION","STATUS","DETAIL"]`。
- **中文仅存在于**：README（文档）、代码注释（非 UI）。core 层 4 个"中文"文件经核实**全是注释/JSDoc**，无需 i18n。

### 错误消息三层来源（决定 i18n 边界）

- **A 类·主动消息**（UI 层，必须 i18n）：`console.log`/`setMessage` 的成功与状态反馈，如 `${id} enabled`、`Added source ${id}`、`no source selected`。
- **B 类·业务错误**（core 层 `throw new Error`，需改错误码）：`src/core/services/install-service.ts:73/78/94/138/162/180/196/198/219/221/222`、`ssot-service.ts:45`、`config-store.ts:170` —— `Skill not found`、`Agent not found`、`Install plan has conflicts`、`Repair target is not a symlink` 等。
- **C 类·系统错误**（`err.message` 透传，前缀包裹）：`src/cli/index.ts:349`、`src/tui/dialogs/AgentManagerDialog.tsx:55/68/93`、`SkillAgentView.tsx:125`、`SourceView.tsx:229/323`、`DoctorView.tsx:57` 等 `` `xxx failed: ${err.message}` `` 模式；err.message 来自 Node fs/git/JSON，不可穷尽。

### 已有可复用基础设施

- `AppConfig.settings`（`src/core/models/config.ts`）已有 `install_strategy`/`default_agent`/`auto_refresh_on_start`，**可扩展加 `language` 字段**。
- `ConfigStore`（`src/core/storage/config-store.ts`）已实现 TOML 序列化/解析（`serializeConfig`/`parseConfig`/`read`/`write`/`init`），语言配置复用同一持久化链路；`createDefaultConfig` 提供 settings 默认值注入点。
- CLI 表格 `renderTable`（`src/cli/columns.ts`）已做 CJK 双宽对齐 + `…` 截断，**列宽引擎已 locale-aware**；翻译后中文普遍更窄，主要风险在英文长串（SSOT→单一可信源、symlink→符号链接方向相反，需双向校验）。

### 术语映射表（zh-CN，已决：全面本地化）

| en | zh-CN | 备注 |
|---|---|---|
| skill | 技能 | |
| source | 来源 | |
| agent | 智能体 | |
| SSOT | 单一可信源 | **比原文长，布局关注** |
| symlink | 符号链接 | **比原文长，布局关注** |
| orphan | 孤儿 | |
| rebound/rebind | 重新绑定 | |
| matrix | 矩阵 | |
| doctor | 健康检查 | |

### 文本规模（需 i18n 的真实 UI 文本）

- TUI：约 20 文件，可见文本集中在 `App.tsx`（help/tabs）、`dialogs/*.tsx`（10 弹窗）、`views/*.tsx`（3 视图）、`components/*`（Matrix/SearchBar/StatusBar/Inspector）。
- CLI：`cli/index.ts`（description/option/console）、`cli/columns.ts`（表头）、`cli/skill-format.ts`。
- 预估字典 key 总量：~80–120 个。

## Requirements

- **R1（语言集合）**：支持 `zh-CN` 与 `en`；字典与注册结构为未来追加语言留扩展点（新增语言 = 追加一份字典 + 注册，无需改业务组件）。
- **R2（切换入口·全通道）**：CLI `--lang` flag + `ASM_LANG` 环境变量 + `config.toml` `settings.language` 持久化 + TUI 运行时快捷键热切换。优先级：`--lang` flag > `ASM_LANG` env > `config.language` > 系统 locale（`LANG`/`LC_ALL`）> `en`。
- **R3（默认语言）**：跟随系统 locale，中文系统→`zh-CN`，其他→`en`；`config.language` 手动覆盖优先级最高。`config.language = "auto"` 表示跟随系统。
- **R4（文本抽离 + 自建字典）**：所有面向用户的 UI 文本（A 类）从硬编码迁移到自建语言字典，代码引用 key。字典结构：`src/i18n/{types.ts,en.ts,zh-CN.ts,index.ts}`；`t(key, lang, params)` 纯函数 + `{{name}}` 插值；**零新依赖**，CLI 与 TUI 共用同一 `t()` 核心。
- **R5（术语·全面本地化）**：核心术语全部按「术语映射表」翻译。
- **R6（TUI 热切换）**：语言为 solid-js signal，`useI18n()` 提供 `{ t, lang, setLang }`；`setLang` 后所有 `t()` 调用响应式重渲染，并异步写回 `config.toml`。切换快捷键需避开现有键位（`1/2/3` tab、`ctrl+r`、`?`、`a/u/d/e/x/r/i/m/enter/space/esc` 等）。
- **R7（错误消息·分层 i18n）**：
  - B 类：core 层业务错误改为错误码体系抛出（如 `throw new BizError("SKILL_NOT_FOUND", { name })`），UI 层 catch 后用 `t()` 翻译；core 层不依赖 i18n 字典，保持纯净。
  - C 类：系统/第三方错误用 i18n 前缀包裹（中文 `"操作失败: "` + 原始 message，英文 `"Operation failed: "` + 原始 message）。
- **R8（布局适配）**：翻译后 help bar、tab、dialog、表格在 `zh-CN` 与 `en` 下均不溢出/截断/错位。重点校验 SSOT/symlink 译后变长处与中文 help bar 变短处的双向显示。

## Acceptance Criteria

- [ ] AC1：`asm` 与 `asm tui` 在 `zh-CN` 与 `en` 两种语言下均可完整运行；中文模式下无残留英文 UI 文本出现在静态界面（A 类全覆盖），英文模式下无残留中文。
- [ ] AC2：语言优先级链 `--lang > ASM_LANG > config.language > locale > en` 全部生效；四级来源各有用例覆盖。
- [ ] AC3：TUI 运行时快捷键可即时切换中/英，切换后界面全部文本立即更新，且偏好异步写回 `config.toml`，重启沿用。
- [ ] AC4：core 层业务错误经错误码 → UI 翻译，中文模式下业务错误为中文；系统错误有中文前缀包裹。
- [ ] AC5：所有 UI 文本走字典；新增第三种语言只需追加字典文件 + 注册，无需改业务组件代码。
- [ ] AC6：TUI help bar / tab / dialog / 表格在 `zh-CN` 与 `en` 下显示完整、对齐正确（含 SSOT/symlink 译后变长处）。
- [ ] AC7：现有测试（`columns.test.ts` 等）保持绿色；为 `t()`、插值、语言解析链、错误码翻译、字典完整性（en/zh key 集合一致）补充测试。
- [ ] AC8：`asm --help` 各 command description 在两种语言下正确；`--lang` flag 在 program 级与（按需）子 command 级可用。

## Out of Scope

- README 的机器翻译流程（README 已双语手工维护）。
- 代码注释翻译（注释跟随项目主语言，不纳入 i18n）。
- 第三方/agent skills 内容本身（SKILL.md 正文）的翻译。
- ICU 复数形式规则、性别、复杂格式化（本规模无此需求；插值用简单 `{{name}}` 替换即可）。
- Windows registry locale 探测（macOS `defaults read -g AppleLanguages` **已纳入** `detectSystemLocale`，因 macOS 上 `$LANG` 常被工具设为 `en_US.UTF-8` 但系统 GUI 语言是中文，仅读环境变量会误判）。

## Decisions Log（brainstorm 已决）

1. 默认语言：跟随系统 locale，回退 `en`；`config.language` 覆盖优先。
2. 术语策略：全面本地化（见术语映射表）。
3. 切换入口：全通道（flag/env/config/locale）+ TUI 热切换。
4. 技术方案：自建轻量字典，零依赖，CLI/TUI 共用 `t()`。
5. 错误范围：分层 i18n（core 改错误码，系统错误前缀包裹）。
6. 热切换：TUI 运行时快捷键，语言为 solid signal。

> 所有 open questions 已解决，无遗留阻塞项。
