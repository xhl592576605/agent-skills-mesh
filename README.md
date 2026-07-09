<div align="center">
  <h1>Agent Skills Mesh</h1>
  <p><strong>三层技能管理器</strong> · 单一可信源 + symlink 分发</p>
  <p>统一管理你所有 AI agent（Claude / Codex / Cursor / Pi …）的 skills</p>
  <p>
    <img alt="license" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square">
    <img alt="runtime" src="https://img.shields.io/badge/runtime-Bun-f9f1e1?style=flat-square&logo=bun">
    <img alt="typescript" src="https://img.shields.io/badge/TypeScript-5.8-3178c6?style=flat-square&logo=typescript&logoColor=white">
    <img alt="tui" src="https://img.shields.io/badge/TUI-OpenTUI-fuchsia?style=flat-square">
  </p>
  <p><a href="README.en.md">English</a> · 简体中文</p>
</div>

---

Agent Skills Mesh（命令名 `asm`）把"技能**从哪来**、**存在哪**、**分发给谁**"拆成三层，用**单一可信源（SSOT）**集中存每一份技能，再通过 **symlink**（Windows 上为 directory junction）分发到你启用的 agent。一份技能只维护一次，所有 agent 共享，告别多副本漂移。

<p align="center">
  <img src="docs/image/preview.gif" alt="Agent Skills Mesh TUI 预览" width="820">
</p>

> TUI 预览（循环演示）：Skill×Agent 矩阵 → 技能详情 → Source 来源管理 → Doctor 健康检查

### 特性

- **三层模型** — `source`（来源）/ `skill`（技能库 SSOT）/ `agent`（启用分发），职责清晰
- **单一可信源（SSOT）** — 每份技能只存一份，一处变更，所有启用的 agent 同步
- **symlink / junction 分发** — 启用/禁用即建/删链接（macOS/Linux symlink，Windows directory junction），零拷贝、即时生效
- **多来源** — git 仓库 / 本地 folder / 单个 skill，自动推断类型
- **全生命周期** — 搜索、添加、更新、删除、rebind 孤儿、批量操作
- **交互式 TUI** — 基于 [@opentui/solid](https://opentui.com)：skill×agent 矩阵 + web 风格浮层弹窗 + fuzzy 搜索
- **健康检查（doctor）** — external / broken-link / orphan / source-missing / conflict，一键定位与修复
- **跨 agent 统一** — 一个技能，按需启用到任意数量的 agent
- **agent 智能启用 + 自定义** — `init` 按安装探测自动启用；支持自定义 agent（任意 `skills_dir`），TUI/CLI 集中启停、添加、删除（内置不可删）
- **中英文双语** — 默认跟随系统语言（macOS 读 `AppleLanguages`，`$LANG` 不准也能识别）；CLI/TUI 全覆盖；`--lang` / `ASM_LANG` / config / TUI `Shift+L` 多通道切换

### 安装

> [!NOTE]
> `agent-skills-mesh@0.1.2` 已发布到 npm。主包会通过 `optionalDependencies` 自动安装当前平台的 standalone 子包（darwin-arm64 / darwin-x64 / linux-x64 / win32-x64）。

**npm 全局安装（推荐）**

```bash
npm i -g agent-skills-mesh
asm --help
```

**从源码开发**

```bash
git clone https://github.com/xhl592576605/agent-skills-mesh.git
cd agent-skills-mesh
bun install            # 需 Bun 1.3+
bun run src/cli/index.ts --help
```

### 快速开始

```bash
asm init                                  # 初始化 ~/.agent-skills-mesh
asm source add <git-repo-or-folder>       # 添加技能来源（自动推断 repo/folder/skill）
asm refresh                               # 扫描来源，构建索引
asm skill search <keyword>               # 搜索可索引技能
asm skill add <name>                     # 从来源复制到 SSOT
asm skill enable <name> --agent claude   # 启用：SSOT → agent symlink
asm tui                                   # 打开交互式 TUI
```

### 使用

#### CLI（三层命令）

| 层 | 命令 | 说明 |
|---|---|---|
| 顶层 | `init` | 初始化 home（config / index / state） |
| | `refresh` | 扫描来源，重建索引 |
| | `doctor` | 健康检查 + 修复建议 |
| | `tui` | 交互式 TUI |
| **source** | `add <target>` | 添加来源（repo/folder/skill 自动推断，`--branch`/`--type` 可选） |
| | `update [id]` | 拉取/重扫来源，报告可更新技能（不自动覆盖 SSOT） |
| | `remove <id>` | 移除来源（默认保留孤儿，`--purge` 级联删除） |
| | `list` | 列出来源 |
| | `enable` / `disable <id>` | 启用/禁用来源 |
| **skill** | `search [query]` | fuzzy 搜索（name / displayName / description / tags） |
| | `add <name>` | 从来源复制到 SSOT（多来源时 `--source <id>` 指定） |
| | `list` / `info <name>` | 列出 / 详情 |
| | `update [name]` | 更新到来源最新版（`--all` 全部） |
| | `remove <name>` | 从 SSOT 删除 + 卸载所有 agent symlink |
| | `rebind <name> --source <id>` | 把孤儿/已有技能重新关联来源 |
| | `enable` / `disable <name> --agent <id>` | 启用/禁用：建/删 agent symlink |
| **agent** | `list` | 列出 agent（含安装检测 / 启停状态） |
| | `add <id> --skills-dir <path> [--name <n>]` | 添加自定义 agent（任意 skills_dir） |
| | `remove <id>` | 移除 agent（不删其 skills_dir） |
| | `enable` / `disable <id>` | 启用/禁用 agent（matrix 列 + symlink） |

#### TUI

```bash
asm tui
```

三个 tab（`1`/`2`/`3` 切换）：

| Tab | 内容 | 主要操作 |
|---|---|---|
| **Skill×Agent** | skill×agent 矩阵，单元格 `[on]`/`[off]`/`[!]` | `space` 切换 · `a`/`d` 批量行 · `enter` 审查 · `i` 详情 |
| **Source** | 来源列表 | `a` 添加 · `u` 更新 · `d` 删除 · `e`/`x` 启停 |
| **Doctor** | 健康问题 + 可 adopt 候选 | `f` 修复选中 · `F` 修复全部 |

| 键 | 作用 |
|---|---|
| `1` / `2` / `3` / `Tab` | 切换 / 循环切换 tab |
| `↑` `↓` `←` `→` / `h j k l` | 移动光标 |
| `space` | 切换单元格（install / uninstall） |
| `enter` | 审查 pending（弹窗确认后 apply） |
| `a` | 当前行全装（所有 agent） |
| `A`（Shift+a） | 打开 agent 管理弹窗 |
| `d` | 删除当前 skill（SSOT + symlink） |
| `i` | 技能详情 |
| `/` | fuzzy 搜索 |
| `L`（Shift+l） | 中 / 英 切换 |
| `ctrl + r` | 全局刷新（重新扫描） |
| `?` | 帮助 |
| `ESC` / `ctrl + c` | 关弹窗 / 退出 |

> agent 管理弹窗内：`space` 启停 agent · `a` 添加自定义 agent · `d` 删除 agent（内置不可删）

> [!TIP]
> 所有写操作（添加/删除/启用/修复）都会弹出 **web 风格浮层确认框**（半透明遮罩），`ESC` / 点击遮罩 / `ctrl+c` 可取消。

### 工作原理

```
┌─────────── source（来源）──────────┐
│ git repo / folder / skill           │
└───────────────┬────────────────────┘
                │ refresh 扫描
                ▼
┌─────────── skill（SSOT）───────────┐
│ ~/.agent-skills-mesh/skills/<name>  │   ← 单一可信源，只存一份
└───────────────┬────────────────────┘
                │ enable（建 symlink）
                ▼
┌─────────── agent（分发）───────────┐
│ claude / codex / pi …               │   ← symlink 指向 SSOT
│ ~/.agent/skills/<name>              │
└────────────────────────────────────┘
```

- **source** = 技能从哪来（远程仓库、本地目录）
- **skill** = 技能存在哪（SSOT，统一纳管）
- **agent** = 分发给谁（symlink 到各 agent 的 skills 目录）

技能在 SSOT 只存一份；agent 通过 symlink 引用，永远指向最新；更新 SSOT 即所有启用的 agent 同步生效。

### 配置

`~/.agent-skills-mesh/config.toml`：

```toml
[agents.claude]
name = "Claude"
skills_dir = "~/.agent/skills"      # symlink 落点
enabled = true

[agents.codex]
name = "Codex"
skills_dir = "~/.codex/skills"
enabled = true

# 可配置任意数量的 agent …
```

#### 语言 / Language

界面支持中文（zh-CN）与英文（en）双语，默认跟随系统 locale（中文系统→中文，其他→英文）。

- **CLI**：`asm --lang zh skill list`（或 `--lang en` / `--lang auto`）；也可设环境变量 `ASM_LANG=zh`
- **TUI**：运行时按 `L`（Shift+l）即时切换中/英，偏好写回 config
- **config**：`settings.language = "zh-CN" | "en" | "auto"`（默认 `auto`，手动设置优先级最高）

优先级：`--lang` flag > `ASM_LANG` > `config.language` > 系统 locale > `en`

### TODO

####  bug

> bug 1–5 已于 2026-07-06 修复（task `07-06-cli-tui-bugfix`）；bug 6（i18n）已于 2026-07-06 完成（task `07-06-i18n-zh-en-switch`）。

- [x] ~~cli 的 `skill` 语义~~ — 已修复：`skill list` 只列已 add 到 SSOT 的技能，`skill search` 列来源候选；TUI matrix 行同步为已入库
- [x] ~~CLI 输出未对齐~~ — 已修复：固定列宽 + 表头 + CJK 双宽对齐 + 长字段截断（`src/cli/columns.ts`）
- [x] ~~TUI add source 无法粘贴~~ — 已修复：PromptDialog 接入 opentui `usePaste`（支持 cmd+v / bracketed paste）
- [x] ~~TUI source skill 详情缺能力~~ — 已修复：多选标记已 add（`[✓]`/`[ ]`）+ `space` 批量勾选 + `return` 批量 add + `i` 查看 SKILL.md
- [x] ~~默认 agent 无视安装~~ — 已修复：`init` 按安装探测决定 enabled；新增 `asm agent list/add/remove/enable/disable`；TUI matrix 默认隐藏 disabled 列，`m` 打开 agent 管理弹窗（启停/添加/删除）
- [x] ~~提供中英文切换（i18n）~~ — 已完成：CLI/TUI 全覆盖中英双语，`--lang` / `ASM_LANG` / config / TUI `Shift+L` 多通道切换



#### 功能
- [x] ~~npm 跨平台平台包发布~~ — 已完成 `0.1.2`：主包 + darwin-arm64 / darwin-x64 / linux-x64 / win32-x64 平台子包已发布
- [ ] 补 TUI 集成测试（discover / doctor / install-plan 端到端）
- [ ] render-smoke 自动化（CI 下 bun vitest pool + vite-plugin-solid）
- [ ] skill 版本 diff 可视化（来源 vs SSOT）
- [ ] 更多来源类型（OCI / zip 归档）
- [ ] 配置导入/导出 + 团队共享

### License

MIT
