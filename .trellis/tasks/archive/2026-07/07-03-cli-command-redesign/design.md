# Design: 重构 ASM CLI 命令骨架为三层模型

## 架构目标

将 ASM CLI 重组为三层命令骨架，每层对应一个概念域，命令边界与数据流向一致：

```txt
Configured Sources                 Skill 库 (SSOT)                       Agent Skill Dirs
git repo / folder / skill   ──skill add──▶ ~/.agent-skills-mesh/skills/<name> ──skill enable──▶ ~/.<agent>/skills/<name>
                                     ▲              │
                  source update      │              │ skill update（显式）
                  （只拉来源）         │              ▼
                                     └──────── Source Registry（config.sources）
```

数据流单向、不可跳层：
- `source add` → 注册来源（`config.sources`）。
- `skill add` → 从 source 复制进 SSOT（`state` 记录 sourceId / 逻辑坐标 / hash）。
- `skill enable` → SSOT → agent symlink。

## 完整命令树（定稿）

```txt
asm init [--force]      asm doctor        asm tui

# Layer 1 — Source（来源）
asm source add <url|path> [--type repo|folder|skill] [--branch <b>] [--id <id>]
asm source update [id]                # 只拉来源，报告哪些 skill 有新版
asm source remove <id> [--purge]      # 默认保留(孤儿)，--purge 级联删 skill + 断 symlink
asm source list

# Layer 2 — Skill 库（SSOT 纳管）
asm skill search [query]              # 在 enabled source 搜可纳管 skill
asm skill add <name> [--source <id>]  # 从 source 复制进 SSOT（同名多源用 --source）
asm skill list                        # 已纳管 skill（含 [orphan] 标记）
asm skill info <name>                 # SSOT路径 / 来源 / hash / enabled agents / 可更新?
asm skill update <name|--all>         # 显式更新 SSOT 到 source 最新
asm skill remove <name>               # 从 SSOT 删 + 断所有 agent symlink
asm skill rebind <name> --source <id> # 孤儿/换源重新关联（+ source add 自动探测）

# Layer 3 — Agent 启用（symlink 分发）
asm skill enable <name> --agent <id>  # symlink: SSOT → agent skill dir
asm skill disable <name> --agent <id> # 移除 symlink
```

## 现状 → 新设计 映射

| 现状命令 | 新设计 | 处理 |
|---|---|---|
| `source add` + `source add-repo` + `skill add`(注册 source) | `source add --type` | 三合一 |
| `source sync` | `source update` | 改名 + 只更新来源（不再自动级联 SSOT） |
| `skill import` + `adopt` | （移除） | 用 `source add --type skill` + `skill add` 替代；external 由 doctor 报告 |
| `install` / `uninstall` | `skill enable` / `skill disable` | 改名 + 收进 skill 组 |
| `skill prefer` | （移除） | 用 `skill add --source` + `skill rebind` 替代 |
| `skill ignore` / `unignore` | （移除） | 用 `skill search <query>` 过滤 |
| `discover` | `doctor` | 合并 |
| `refresh` | 各命令内部自动触发 | 降级，保留顶层手动入口 |
| `skill <sub>` / `source <sub>` 手动分发 | commander 原生子命令 | 重构 |

## 两步分离更新流程

```txt
1. asm source update [id]
   ├─ git pull --ff-only（repo）/ 重扫（folder、skill）
   ├─ 非快进 → 报告失败，不改 SSOT
   └─ 扫描 source skills，与 state.contentHash 比较
      → 输出: skill 'foo' 有新版 (oldHash → newHash)，待 skill update

2. asm skill update foo   （或 --all）
   ├─ 校验 source 已 update 且 hash 不同
   ├─ 安全替换 SSOT：temp copy → validate SKILL.md → backup → rename → rollback on fail
   ├─ 更新 state.contentHash / updatedAt
   └─ 校验 enabled agent symlink 仍指向 SSOT（缺失则重建，被占用则 conflict）
```

## 孤儿 Skill 状态机

```txt
                  source remove（无 --purge）
  正常纳管 ─────────────────────────▶ 孤儿
      ▲                                 │
      │ rebind / source add 自动探测     │ skill remove
      │                                 ▼
  正常纳管 ◀──────────────────────  彻底删除
      │ source remove --purge（直接到删除）
```

| 状态 | SSOT 内容 | enable/disable | skill update | list/info 标记 |
|---|---|---|---|---|
| 正常 | 有 | ✅ | ✅ | 来源: `<sourceId>` |
| 孤儿 | 有 | ✅ | ❌（source 缺失） | `[orphan]` / 来源: 缺失 |
| 删除 | 无 | — | — | — |

### 重新关联匹配键

孤儿 skill 在 state 保留稳定逻辑坐标（不依赖 sourceId）：

```ts
source: {
  sourceId: "my-repo",              // 已删 → orphan
  sourceType: "git-repo",
  url: "https://github.com/x/y",    // 稳定逻辑坐标
  branch: "main",
  relativePath: "skills/foo",       // 稳定逻辑坐标
  orphanedAt: "..."
}
```

- **自动探测**（`source add` 时）：git 类按 `url + branch + relativePath` 匹配；folder/任意类按 `contentHash` 匹配。匹配到 → 关联并提示（hash 一致静默，hash 不同提示有新版）。
- **显式**（`skill rebind --source`）：校验目标 source 提供同名 candidate 后关联，恢复更新能力。

## source remove 行为矩阵

| 操作 | source 注册 | SSOT skill | agent symlink | state |
|---|---|---|---|---|
| `source remove <id>` | 删 | 保留（孤儿） | 不变 | source 标 orphan |
| `source remove <id> --purge` | 删 | 删 | 断开 | 删 record |

## 存储三层定位与精简

SSOT 任务引入 `state.json` 后，三个存储的职责必须划清，避免双写漂移：

| 存储 | 定位 | 写入者 | 本任务变更 |
|---|---|---|---|
| `config.toml` | 用户意图（手写） | 用户 / `source add` 等命令 | 删除 `[skill-overrides]` 后即纯净，不再增删字段 |
| `state.json` | SSOT 管理事实（真相源） | ASM 命令 | 不动，作为唯一事实 |
| `index.json` | refresh 派生的**可重建缓存** | `refreshIndex()` | 温和瘦身（见下） |

**不变量**：index.json 的任何字段都能从 (config + state + 文件系统) 重建；当 index 与 state 冲突时，以 state 为准并触发重建。

### config.toml

移除 `[skill-overrides.<name>]` 段（`managed` / `ignored` / `preferredSourceId` / `preferredCandidateId` 全部废弃）。config 回归纯意图：

- `paths`（含 skills SSOT root）
- `sources`（来源注册表）
- `agents`（agent skills_dir）
- `settings`（install_strategy 等）

### index.json 瘦身

```ts
interface IndexFile {
  version: 1;
  updatedAt: string;
  skills: Record<string, SkillRecord>;              // 唯一真缓存（source 扫描结果 + status）
  installations: Record<string, InstallationRecord>; // symlink 健康投影
  issues: IssueRecord[];                              // 派生缓存
  // 删除 sources 镜像
}

interface SkillRecord {
  name: string;
  displayName: string;
  description?: string;
  tags: string[];
  status: SkillStatus;        // 含 orphan，不含 ignored
  candidates: SkillCandidate[];
  supportedAgents?: string[];
  // 删除 preferredCandidateId / preferredSourceId / ignored
}

type SkillStatus = "managed" | "orphan" | "conflict" | "discovered" | "missing";
// 删除 ignored（随 skillOverrides 废弃）；新增 orphan
```

### orphan 计算（落进 calculateStatus）

孤儿判定是实时派生，不新增 config/state 字段：

```ts
// 在 mergeCandidates / calculateStatus 中：
const installed = state.installedSkills[name];
if (installed?.source.kind === "configured-source") {
  const sourceExists = config.sources.some((s) => s.id === installed.source.sourceId);
  status = sourceExists ? "managed" : "orphan";
}
```

- `orphan`：SSOT 内容仍在，可 `enable`/`disable`（纯 symlink 操作，不依赖 source）；`skill update` 失败；list/info/doctor 标记 `[orphan]`。
- `source add` 自动探测或 `skill rebind --source` 把 orphan 重新关联为 managed。

### installations 重定位

`detectInstallations(config, skills, state)` 改为以 `state.enabledAgents` 为 expected：

- 遍历 `state.installedSkills[name].enabledAgents[agentId]`：期望 `agent.skills_dir/<name>` 是 symlink 指向 `ssotPath`。结果为 `installed` / `missing`（声明 enabled 但 symlink 不存在）/ `broken-link`（symlink 失效）/ `conflict`（被真实目录或外部 symlink 占用）。
- 遍历 agent-dir 扫描：ASM 未纳管的真实目录 / 外部 symlink → `external`（供 doctor 报告）。

`InstallationRecord.status` **只表达 symlink 健康度**，不再表达「是否 enabled」。`available`（未 enable 且无 symlink）不写入 installations，由 `state.enabledAgents` 不含该 agent 推出。`installedCandidateId`（含 hash 的不稳定 id）删除。

## commander 原生子命令

**框架决策**：实测确认 cac `^6.7.14` 不支持嵌套子命令（注册 `cli.command('source add <path>')` 后输入 `asm source add foo`，`matchedCommand` 为 undefined，三个词被当成位置参数），无法满足「每子命令独立 help」。改用 commander（`pnpm add commander`，从依赖移除 cac）。

`source` / `skill` 改为 commander 嵌套：

```ts
const source = program.command("source").description("Source commands: add, update, remove, list");
source.command("add <url|path>").option("--type <t>").option("--branch <b>").option("--id <id>").action(...);
source.command("update [id]").action(...);
source.command("remove <id>").option("--purge").action(...);
source.command("list").action(...);

const skill = program.command("skill").description("Skill commands: search, add, list, info, update, remove, rebind, enable, disable");
skill.command("search [query]").action(...);
skill.command("add <name>").option("--source <id>").action(...);
skill.command("list").action(...);
skill.command("info <name>").action(...);
skill.command("update <name>").option("--all").action(...);
skill.command("remove <name>").action(...);
skill.command("rebind <name>").option("--source <id>").action(...);
skill.command("enable <name>").option("--agent <id>").action(...);
skill.command("disable <name>").option("--agent <id>").action(...);
```

每个子命令独立 help/option/校验，对齐 spec `quality-guidelines.md` 签名。

## 与 SSOT 任务的衔接

`07-03-ssot-skill-management` 已归档完成，底层就绪：

- **state 模型**：`InstalledSkillRecord.source` 的逻辑坐标字段（`url`/`branch`/`relativePath`）支撑孤儿匹配与 rebind。
- **SSOT 文件操作**：安全复制/替换/回滚支撑 `skill update`。

本任务需补齐的「两步分离服务层」：当前 `source sync` 仍自动级联替换 SSOT，需拆为 `source update`（只拉来源、报告可更新）与 `skill update`（显式替换 SSOT）两个服务函数。

## 兼容性

版本未发布，破坏性可接受：

- 不提供旧命令 shim（`install`/`uninstall`/`adopt`/`import`/`prefer`/`ignore`/`discover` 全部移除或改名）。
- 不迁移旧 config（`skill-overrides` 段直接废弃）。
- 测试以新命令骨架为准。

## 风险与取舍

- **两层解耦代价**：两步更新多一次操作，但可控性提升，符合用户选择。
- **孤儿可见性**：靠 list/info/doctor 标记保证不变成隐藏垃圾。
- **去掉 adopt 的原地接管**：agent 目录 external 真实目录需用户手动清理后 enable，不提供专门移动命令（避免特殊文件操作路径）。
- **commander 重构**：改动面大，需完整 smoke 覆盖。
