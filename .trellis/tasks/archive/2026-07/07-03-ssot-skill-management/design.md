# Design: 对齐 cc-switch 的 SSOT Skill 管理

## 架构目标

将 ASM 从“agent 目录 symlink 直接指向 source candidate”改为三层模型：

```txt
Configured Sources                 Installed Store (SSOT)                 Agent Skill Dirs
repos/<source>/.../SKILL.md  ──copy/update──> ~/.agent-skills-mesh/skills/<skill>/ ──symlink──> ~/.pi/agent/skills/<skill>
local-dir / single-skill                                 │                         ~/.claude/skills/<skill>
                                                         └── state records
```

- **Source**：只负责发现候选与提供更新来源。
- **SSOT installed store**：唯一真实内容源，固定 `~/.agent-skills-mesh/skills`。
- **Agent dirs**：只允许 symlink 指向 SSOT；不允许 copy fallback。
- **State**：持久记录 installed skill 的来源、SSOT 路径、hash、enabled agents、timestamps。

## 与 cc-switch 的对齐点

- 对齐：SSOT 作为 installed store；agent 目录只是分发目标。
- 对齐：安装记录持久化，包含 source metadata、content hash、enabled app/agent 状态。
- 对齐：更新已安装 skill 时替换 SSOT 内容，再同步/校验所有启用 agent。
- 有意不同：ASM 不支持 cc-switch 的 copy fallback；为了“保证 SSOT”，只允许 symlink。
- 有意不同：ASM 版本未发布，不做旧语义迁移；允许破坏性重构。

## 数据模型

### AppConfig

破坏性调整默认配置：

- `paths` 新增 `skills = "~/.agent-skills-mesh/skills"`，作为 SSOT root。
- 默认 `sources` 不再包含 `global-agents-skills` / `global-dir` 指向 SSOT。SSOT 不作为普通 source 扫描。
- `paths.local` 继续用于 `skill import` 或本地缓存源；不等同于 installed SSOT。

> 版本未发布，`AppConfig.version` 可保持 `1` 或 bump；若 bump，需要 store 显式处理默认缺省值。实现时以最小改动为准。

### StateFile / InstalledSkillRecord

新增 `src/core/models/state.ts` 与 `src/core/storage/state-store.ts`。

建议模型：

```ts
export interface StateFile {
  version: 1;
  installedSkills: Record<string, InstalledSkillRecord>; // key = skillName
}

export interface InstalledSkillRecord {
  skillName: string;
  displayName: string;
  description?: string;
  tags: string[];
  ssotPath: string;
  source: InstalledSkillSource;
  contentHash: string;
  installedAt: string;
  updatedAt: string;
  enabledAgents: Record<string, InstalledAgentRecord>; // agentId -> record
}

export interface InstalledAgentRecord {
  agentId: string;
  targetPath: string;
  linkedAt: string;
}

export type InstalledSkillSource =
  | {
      kind: "configured-source";
      sourceId: string;
      sourceType: SourceType;
      sourcePath: string;      // source root at install/update time
      relativePath: string;   // skill dir relative to source root
      url?: string;
      branch?: string;
    }
  | {
      kind: "manual-import";
      originalPath?: string;
    };
```

设计原则：

- `skillName` 单实例，不引入 alias/variant。
- `relativePath` 是更新定位的稳定键；不要依赖当前含 hash 的 `SkillCandidate.id`。
- `contentHash` 表示 SSOT 目录内容 hash，用于更新检测和 doctor。
- `enabledAgents` 是 installed state，而不是从 symlink 反推的唯一来源；refresh/detect 负责验证文件系统是否符合 state。

## Index 与 Refresh 语义

### refresh sources

`buildRefreshSources(config)` 调整：

- 扫描 `config.sources` 中 enabled 的 configured sources。
- 扫描每个 agent 的 `agent-dir`，用于发现 external / broken / conflict。
- 不再把 SSOT `paths.skills` 作为 `global-dir` source 扫描。

### skills 列表

`refreshIndex(config, previous, state)` 应合并两类事实：

1. source scanner 产出的 discoverable candidates；
2. state 中 installed skills 对应的 managed records。

合并规则：

- 若 state 有 installed skill，则该 skill 在 `index.skills` 中必须存在，即使 source 当前缺失。
- 若同名有 source candidates，则用于可更新/可切换来源；installed 记录不作为 candidate 参与 conflict。
- 多 source candidates 且无 preference 时仍可标记 `conflict`，但已安装状态不应被 SSOT candidate 放大成 conflict。
- 若 state source 对应 candidate 缺失，可在 issues 中报告 `installed-source-missing` 或用现有 `missing` 状态扩展。

> 实现可以选择扩展 `SkillStatus`，例如新增 `installed` / `source-missing`；也可以保留 `managed/missing` 并通过 issue 表达。设计倾向新增明确状态，但需评估 TUI/CLI 影响。

### installations 检测

`detectInstallations(config, skills, state)` 改为以 state 中 installed SSOT 为 expected target：

- agent enabled + state.enabledAgents[agentId] 存在：期望 `agent.skills_dir/<skill>` 是 symlink，且 target 指向 `InstalledSkillRecord.ssotPath`。
- target missing：可报 `missing` 或 `available`，取决于是否 state 声明该 agent enabled。
- symlink 指向 SSOT：`installed`。
- symlink 指向 source repo 或外部路径：`external`/`conflict`，不再视为 managed。
- 真实目录：`external`，可由 import/adopt 接管。

## 安装流程

### buildInstallPlan

输入：`config`、`index`、`state`、`skillName`、`agentId`。

计划动作应描述：

1. `copy-to-ssot`：如果 state 无该 skill，或选择替换来源，则从 selected candidate 复制到 `paths.skills/<skillName>`。
2. `create-symlink`：在 agent skill dir 创建 symlink 指向 SSOT。
3. `update-state`：记录 installed skill 与 enabled agent。
4. conflict：目标 agent path 已存在非 ASM 管理 symlink/真实目录时拒绝。

### applyInstallPlan

安全策略：

- 复制到临时目录：`paths.skills/.tmp-<skill>-<pid>-<time>`。
- 校验临时目录含 `SKILL.md`。
- 目标不存在时 rename 临时目录为 SSOT path。
- 目标已存在且需要替换时，先备份或 rename 到 `.bak-*`，再 rename 新目录；失败回滚。
- agent symlink 创建前确认目标不存在或为同一 symlink；不同 symlink/真实目录拒绝。
- state write 使用 atomic write。

## Source sync 自动更新

`source sync` 保持 git 行为：

- 缺失 clone：clone。
- 已存在：`git pull --ff-only`。
- 非快进：报告失败，不自动 merge/rebase/stash/force。

新增自动更新阶段：

1. 对 sync 成功的 sourceId，查 state 中 `source.kind="configured-source" && source.sourceId === sourceId` 的 installed skills。
2. 用 `source.path + relativePath` 定位最新 candidate 目录。
3. 计算 source skill dir hash；与 state.contentHash 比较。
4. 不同则执行安全替换 SSOT：备份旧 SSOT → 复制新目录 → 更新 state.updatedAt/contentHash/metadata。
5. 对 enabledAgents 校验 symlink 指向仍正确；如缺失可重建 symlink，如被真实目录/外部 symlink 占用则报告 conflict。
6. sync 输出包含：source sync 结果、updated skill 列表、skipped/conflict 列表。

## Import / Adopt 外部 skill

当前 `adopt` 语义要调整：

- 从 agent-dir 发现真实目录时，接管方式为 move/copy 到 SSOT installed store，原 agent path 改为 symlink 指向 SSOT。
- 写 state installed record，source.kind = `manual-import`。
- 不再写 `[skill-overrides.<name>] managed = true` 作为主状态；config override 可保留 ignore/prefer，但 managed 应迁移为 state 事实。

`skill import <path>` 可调整为：

- 不再注册 single-skill source，或新增单独命令语义区分：
  - `skill add <path>` = 添加 source；
  - `skill import <path>` = 导入为 installed SSOT。
- 由于版本未发布，可以破坏性重命名/调整 CLI 文案，但需保持清晰。

## CLI 影响

建议命令语义：

- `asm source add <path>`：注册 discover source。
- `asm source add-repo <url>`：clone 并注册 discover source。
- `asm source sync [id]`：同步 source，并自动更新相关 installed SSOT。
- `asm install <skill> --agent <agent>`：从 selected candidate 安装/启用到 agent；真实内容复制到 SSOT。
- `asm uninstall <skill> --agent <agent>`：仅移除该 agent symlink，并从 state.enabledAgents 删除该 agent；不删除 SSOT 真实内容。
- 后续可加 `asm skill remove <skill>`：删除 SSOT installed record 和所有 agent symlink（本任务可不做，除非测试需要）。
- `asm discover`：报告 agent 目录中的 external/real dirs、broken links、source conflicts。
- `asm adopt <skill>`：导入 external real dir 到 SSOT，并 symlink 回原 agent。

## TUI 影响

- Matrix 的 installed 判断来自 `index.installations`，该记录会改为以 state/SSOT 为 expected target。
- SkillInspector 候选列表不应显示 SSOT installed store 作为普通 source candidate。
- 若新增 SkillStatus，需要更新 TUI cell/labels。

## 兼容性与迁移

用户已确认版本未发布，允许破坏性更新：

- 不实现旧 installation symlink 迁移。
- 不保留默认 `global-dir` source 指向 SSOT 的旧语义。
- 可重建 config/index/state，测试以新默认行为为准。

## 安全与回滚

- 所有文件写入必须通过 plan/apply 或明确服务函数执行。
- 不覆盖真实目录/外部 symlink。
- 替换 SSOT 目录必须有临时目录和备份/回滚。
- state/config/index 写入使用 atomic write。
- 测试必须使用临时 ASM_HOME 和临时 agent dirs。

## 设计取舍

- **不使用 lock file**：ASM source 已在 config 中，installed state 记录 sourceId+relativePath+hash 足以支持本地 clone 更新。
- **不支持 copy fallback**：牺牲兼容性，换取严格 SSOT。
- **不扫描 SSOT 作为 source**：避免重复候选/conflict，代价是需要 state 合并 installed skills 到 index。
- **source sync 自动更新**：符合用户选择，但需要更强回滚和输出提示。
