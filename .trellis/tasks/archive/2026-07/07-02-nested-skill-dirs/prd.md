# PRD: 扫描器支持嵌套 skill 目录（完整对齐 skills.sh）

## 目标 / 用户价值

让 asm 能正确扫描采用 `skills/<category>/<skill>/SKILL.md` 二级嵌套布局、以及通过 `.claude-plugin/plugin.json` 显式声明 skill 的仓库（典型如 `mattpocock/skills`），使 `asm refresh` 不再遗漏这类仓库中的 skill，从而让 `source add-repo` 添加的分类/插件仓库真正可用。

## 背景（已确认事实）

### 现象
`asm source add-repo git@github.com:mattpocock/skills.git` 后 `asm refresh`，该 git-repo 源索引到 **0 个 skill**。

### 根因
`src/core/scanners/skill-scanner.ts` 的 `findSkillDirs` / `addChildSkillDirs` 只扫描 root 直接子目录 + `<root>/skills/` 直接子目录（均 depth-1），不支持 `skills/<category>/<skill>/SKILL.md`（depth-2）。mattpocock 结构为 `skills/{misc,personal,in-progress,engineering,productivity}/<skill>/SKILL.md`，分类目录自身无 `SKILL.md`，被整体跳过。

### 行业标准：skills.sh（vercel-labs/skills，`npx skills`）
`discoverSkills()`（`src/skills.ts`）+ `findSkillMdPaths()`（`src/blob.ts`）+ `getPluginSkillPaths()`（`src/plugin-manifest.ts`）策略：
1. **priority 目录**（按序）：root → `skills/` → `skills/.curated|.experimental|.system` → plugin manifest 声明路径。
2. **根目录** depth-1，避免 `examples/foo/SKILL.md` 噪音。
3. **容器目录**（`skills/` 等）depth-2，支持 `skills/<category>/<skill>/SKILL.md`。
4. **遇 SKILL.md 不再下钻**：子目录已含 SKILL.md 则不向孙目录扫描，防父子重复。
5. **SKIP_DIRS** = `node_modules / .git / dist / build / __pycache__`。
6. 按 skill name 去重；priority 未命中时全树递归 `maxDepth=5`。
7. **plugin manifest**：读 `.claude-plugin/marketplace.json`（多插件）或 `.claude-plugin/plugin.json`（单插件）；skill 路径须 `./` 开头；`isContainedIn` 防路径穿越。

### plugin manifest 对 mattpocock 的直接价值（证据）
mattpocock 仓库根 `.claude-plugin/plugin.json` 内容：
```json
{ "name": "mattpocock-skills", "skills": ["./skills/engineering/tdd", ... 共 20 条] }
```
即该仓库**主动用 plugin manifest 声明 skills**。支持 plugin manifest 能直接提升 mattpocock 的发现准确度。

### cc-switch 与扫描无关
`farion1231/cc-switch` 是 API provider/model 配置切换工具，asm 仅借用其 7 个 agent 的 `skills_dir` 路径约定，扫描逻辑无交集。

## 兼容性事实（代码层）

- `SkillCandidate.path` 存 skill 目录绝对路径，`hash` 为该目录 `SKILL.md` 的 sha256——嵌套与 manifest 路径**无需改动 SkillCandidate / SkillRecord 模型**。
- `refresh-service.ts` 的 `mergeCandidates` 已按 `skillName` 聚合多 candidate（跨源去重）。
- `buildRefreshSources` 把每个 agent 的 `skills_dir` 作为 `agent-dir` 源（`origin=agent-dir`），应**保持 depth-1**，不回归现有 discover 行为。
- 引入 depth-2 后**必须**新增"遇 SKILL.md 不下钻"，否则 skill 内嵌套的 `examples/<x>/SKILL.md` 会被误判为独立 skill。

## 需求（完整对齐 skills.sh，scope 已决）

1. configured source（`git-repo` / `local-dir`）按 **priority 顺序**扫描：root → `skills/` → `skills/.curated` → `skills/.experimental` → `skills/.system` → plugin manifest 声明路径。
2. **容器目录**（root 除外的 priority 目录）走 **depth-2**：发现 `skills/<category>/<skill>/SKILL.md`。
3. **根目录**保持 depth-1；**plugin manifest 路径**保持 depth-1（manifest 已指向 skill 父目录）。
4. **遇 SKILL.md 不下钻**：子目录已含 `SKILL.md` 则不再向其孙目录扫描。
5. **SKIP_DIRS** 过滤：`node_modules`、`.git`、`dist`、`build`、`__pycache__`。
6. **plugin manifest 支持**：读 `.claude-plugin/plugin.json` 与 `.claude-plugin/marketplace.json`；skill 路径须 `./` 开头；`isContainedIn` 防路径穿越；只处理本地路径，跳过远程 `source`。
7. **fallback 递归** `maxDepth=5`：priority 目录全部未命中时，全树兜底发现任意深度的 `SKILL.md`。
8. `agent-dir` / `global-dir` 源**保持 depth-1**（对齐 skills.sh 对 agent 前缀的 depth-1 处理），不走 priority/plugin/fallback。
9. candidate 级去重：同一 source 内按 resolved path 去重，避免 priority + fallback 重复产出同一 candidate。

## 验收标准

- **AC1**：`asm refresh` 后 mattpocock/skills 的 `skills/<category>/<skill>/SKILL.md` 全部被索引（含 manifest 声明的 20 个与目录扫描发现的额外 skill）。
- **AC2**：含 `examples/<x>/SKILL.md` 的 skill 目录不会被拆成多个 candidate（遇 SKILL.md 不下钻）。
- **AC3**：`node_modules` / `.git` / `dist` / `build` / `__pycache__` 被跳过。
- **AC4**：含 `.claude-plugin/plugin.json`（声明 `skills: ["./..."]`）的仓库，声明的 skill 被发现；`./` 前缀缺失或路径逃逸（`..`）的条目被忽略。
- **AC5**：priority 目录全空（无 `skills/`、无 manifest）时，fallback 递归能发现 ≤5 层深的 `SKILL.md`。
- **AC6**：现有扫描相关测试全部通过；新增 depth-2 / 不下钻 / SKIP_DIRS / plugin manifest / fallback / priority 顺序单元测试。
- **AC7**：`agent-dir` / `global-dir` 源扫描行为不变（现有 discover / refresh 测试无回归）。

## 非目标（out of scope）

- **AGENT_PROJECT_SKILL_DIRS（28 个 `.<agent>/skills` 前缀）**：asm 的 agent `skills_dir` 是独立 source（安装目标），不是仓库内扫描目标，不适用。
- **plugin grouping（`pluginName` 元数据）**：skills.sh 用 `getPluginGroupings` 给 skill 打 plugin 名分组；asm `SkillRecord` 无此字段，MVP 不引入分组元数据，仅用 manifest 扩展扫描入口。
- **远程 GitHub Trees API 快速发现**（skills.sh `blob.ts`）：asm 走本地 clone 后扫描，不需要远程 tree API。
- **skills.sh 的 `--full-depth` / `includeInternal` / skills-lock 跳过已安装项目 skill** 等 CLI 语义：asm 的 index/override 模型不同，不照搬。

## 决策记录

- **Q1（scope）**：已决 → **完整对齐 skills.sh**（需求 1–9）。理由：plugin manifest 对 mattpocock 有直接价值（仓库自带 `plugin.json`），fallback 递归覆盖无 `skills/` 前缀布局，完整对齐收益大于复杂度成本。
- **manifest 语义**：采用 skills.sh 的**并集 + 去重**（manifest 作为补充 search dir，目录扫描照常，candidate 按 path 去重、skill 按 name 聚合），而非"manifest 独占"——避免漏掉 manifest 未声明但仓库实际存在的 skill。
