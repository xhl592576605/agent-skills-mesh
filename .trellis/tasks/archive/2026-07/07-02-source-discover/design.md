# Source 管理与 Discover — 技术设计

## 架构总览

沿用归档任务的分层架构。本次新增 Application Service 与 CLI 子命令；同时**把用户意图层从 index.json 迁移到 config.toml**（方案 B），并新增 adopt 物理接管能力。Core Domain Models 与 scanner 扫描结构基本不动。

```txt
CLI commands (source / skill / discover)              ← 新增
        ↓
Application Services                                  ← 新增 source/skill/discover-service
  source-service   add / add-repo / sync / remove / enable / disable
  skill-service    add / import / prefer
  discover-service discover / adopt / ignore / unignore
        ↓
Storage (config-store / index-store)                  ← config-store +write；index 回归纯事实
        ↓
File System / Git (utils/git.ts)                      ← 新增 git clone/pull
```

## 现状复用点（不改动）

- `SourceConfig` / `AppConfig` 模型已就绪（`src/core/models/config.ts`）。
- `serializeConfig` / `parseConfig` 已支持 `[[sources]]` 完整字段 —— 本次扩展 `[skill-overrides]` 表。
- `skill-scanner`：`single-skill`/`local-dir`/`git-repo` → origin=`configured-source`；`global-dir`/`agent-dir` → 对应 origin。
- **关键确认**：scanner 用 `fs.readdir({ withFileTypes: true })` + `Dirent.isDirectory()` 判断子目录，对 symlink 返回 false（lstat 语义）—— **agent-dir 里的 symlink 会被自动跳过**，不会产生散落 candidate。adopt 在原位建 symlink 后不会被误扫为 discovered。
- `refreshIndex.mergeCandidates` 已能按 name 分组 candidate。
- `InstallationRecord` 检测已含 `external` / `broken-link` / `conflict`。
- `utils/fs.ts` 已有 `atomicWriteFile`、`pathExists`、`ensureDir`。

## 关键设计决策（已与用户确认）

### DECISION 1：prefer / ignore / adopt 持久化 → config.toml（方案 B）✅

用户意图持久化到 `config.toml` 新增的 `[skill-overrides.<name>]` 表，不再存 `index.json`。

- `index.json` 回归纯事实层（扫描结果 + 安装状态）。
- `config.toml` = 用户意图（source 配置 + skill 偏好）。
- `refresh` 从 `config.skillOverrides` 读意图，合并到 `SkillRecord`（status / preferredSourceId 等）。
- 意图不会被 `asm init --force` 或 index 重建清掉 —— 符合用户确认的数据分层理念。

### DECISION 2：adopt = 物理接管 + 原位回装 ✅

`adopt <discovered-skill>`：

1. 取该 skill 的 discovered candidate 真实目录（如 `~/.pi/agent/skills/my-helper`）。
2. **移动**到 `~/.agents/skills/<name>`（通用 global source 目录）；目标已存在同名则报错不覆盖。
3. 在**原 candidate 路径建 symlink** 指向新位置 —— 原 agent 立即可用，且现在是受管 symlink（非散落真实目录）。
4. 写 `config.toml` 的 `[skill-overrides.<name>] managed = true`。
5. 触发一次 refresh；该 skill 因 `overrides.managed` 状态变 `managed`。

**为何原位回装**：用户要 adopt 对原 agent 透明 —— skill 搬进统一 source，原 agent 照常能用，无需手动 install。这同时把 agent 目录"扶正"为纯 symlink 区。

**多 candidate 情况**：MVP 只支持单 candidate 的 discovered skill（多数场景）。若一个 skill 有多个 discovered candidate（多个 agent 都手建了同名真实目录），adopt 报错提示先用 `skill prefer` 指定真身来源，或逐个 adopt。

**为何不用"注册 single-skill source"**：原方案会在 config 留一堆指向 `~/.agents/skills/foo` 的重复 source 条目。直接复用已有的 global source（`global-agents-skills`）+ `managed` override 更干净。

### DECISION 3：source id 生成策略

基于 path 或 git repo 名生成 slug，冲突追加 `-2`/`-3`；提供 `--id <custom>` 自定义。

- `add <~/foo/skills>` → `skills`，冲突 → `skills-2`
- `add-repo <https://github.com/x/y>` → repo 名 `y`
- `skill add/import <~/foo>` → skill 目录名

### DECISION 4：source remove 是否删 repos 目录

`remove <id>` 默认只从 config 删除，不删 `repos/` 下已 clone 目录（安全可恢复）。提供 `--purge` 显式删除，且删除前校验目录确实属于该 source。

### DECISION 5：git sync 冲突策略

`git pull --ff-only`。非快进时报告失败、列出 source id，不自动 stash/rebase/force。用户自行进 `repos/<id>` 处理。

## 数据模型扩展

### AppConfig 新增 skillOverrides

```ts
// src/core/models/config.ts
export interface SkillOverride {
  ignored?: boolean;
  managed?: boolean;                 // adopt 标记：强制 managed
  preferredSourceId?: string;        // prefer：消歧 source
  preferredCandidateId?: string;     // prefer：消歧具体 candidate
}

export interface AppConfig {
  // ... 既有字段
  skillOverrides: Record<string, SkillOverride>;   // 新增
}
```

`createDefaultConfig()` 初始化为 `{}`。

### SkillRecord 不变

`SkillRecord` 仍保留 `preferredSourceId` / `preferredCandidateId` / `ignored` 字段（用于 refresh 计算后的事实快照），但**来源**从 previous index 改为 `config.skillOverrides`。`SkillRecord` 不再新增 `managed` 字段 —— `managed` 是输入（override），`status="managed"` 是输出，无需冗余存储。

## 序列化扩展（config-store.ts）

`serializeConfig` / `parseConfig` 新增 `[skill-overrides.<name>]` 表：

```toml
[skill-overrides.my-helper]
managed = true

[skill-overrides.bar]
ignored = true

[skill-overrides.foo]
preferredSourceId = "my-skills"
```

- 序列化：遍历 `config.skillOverrides`，每个 entry 输出一个 `[skill-overrides.<name>]` 块，只写已设置的字段。
- 解析：识别 `[skill-overrides.<name>]` section，填充到 `config.skillOverrides[name]`。
- name 作为 TOML key，若含特殊字符（`-` 已合法，`.` 不行）需注意：skill name 一般是 `[a-z0-9-]`，安全；若遇非法字符报错提示重命名。

## Storage 层扩展

### ConfigStore.write（新增）

```ts
class ConfigStore {
  // 已有: exists / init / read
  async write(config: AppConfig): Promise<void> {
    await atomicWriteFile(this.configPath, serializeConfig(config));
  }
}
```

source/skill/discover-service 都走「read → mutate → write」。

### IndexStore（不变）

已有 `init` / `read` / `write` / `exists`。不再持久化意图（prefer/ignore 改写 config）。index 回归纯事实。

## refresh / calculateStatus 重构

`refresh-service.ts` 的 `mergeCandidates` 与 `calculateStatus` 改为读 `config.skillOverrides`（而非 previous index）：

```ts
export async function refreshIndex(config: AppConfig, previous: IndexFile = createEmptyIndex()): Promise<IndexFile> {
  const sources = buildRefreshSources(config);
  const candidates = (await Promise.all(sources.filter(s => s.enabled).map(scanSource))).flat();
  const skills = mergeCandidates(candidates, config.skillOverrides);   // ← 改读 overrides
  // ... 其余不变
}
```

`calculateStatus` 新分支（优先级从上到下）：

```txt
overrides.ignored         → ignored
candidates.length === 0   → missing
overrides.managed         → managed          // adopt 标记，跳过 discovered/conflict
candidates.length > 1 且无 preferred → conflict
有 preferredSourceId       → managed          // prefer 消歧成功
candidates 全为 global-dir/agent-dir → discovered
否则                       → managed          // 有 configured-source candidate
```

`mergeCandidates` 把 `overrides.preferredSourceId` 写入 `SkillRecord.preferredSourceId`（仅当对应 candidate 存在），供 install-service 选默认 source。

> 注：previous index 仍用于检测 `missing`（曾经有、现在没 candidate），但不再用于保留意图。

## Application Services

### source-service.ts

```ts
export async function addSource(config, dirPath, opts?: { id?: string }): Promise<SourceConfig>
  // 校验 path 存在；slug 去重；config.sources.push；ConfigStore.write

export async function addRepoSource(config, gitUrl, opts?: { id?: string; branch?: string }): Promise<SourceConfig>
  // git clone 到 repos/<slug>（home 下）；成功后注册 git-repo source；失败不写 config

export async function syncSources(config, sourceId?): Promise<SyncResult[]>
  // 无 id：遍历 enabled git-repo；有 id：单个
  // repos/<id> 不存在 → clone；存在 → pull --ff-only；返回每项结果

export async function removeSource(config, id, opts?: { purge?: boolean }): Promise<void>
export async function setSourceEnabled(config, id, enabled: boolean): Promise<void>
export async function listSources(config): Promise<SourceConfig[]>
```

### skill-service.ts

```ts
export async function addSingleSkill(config, dirPath, opts?: { id?: string }): Promise<SourceConfig>
  // 注册 type=single-skill source；校验 dir/SKILL.md 存在

export async function importSkill(config, dirPath, opts?: { id?: string }): Promise<SourceConfig>
  // 完整目录拷贝到 local/<name>/；注册 single-skill source 指向 local 路径；失败回滚

export async function preferSkill(config, index, skillName, sourceId): Promise<void>
  // 校验 sourceId 存在且提供该 skill candidate；写 config.skillOverrides[name].preferredSourceId
```

### discover-service.ts

```ts
export interface DiscoverEntry {
  kind: "discovered" | "external" | "broken-link" | "conflict";
  skillName: string;
  detail: string;
}

export function listDiscover(index: IndexFile): DiscoverEntry[]
  // 纯过滤：遍历 index.skills（discovered/conflict）+ index.installations（external/broken-link）

export async function adoptSkill(config, index, skillName): Promise<void>
  // 1. 校验 status=discovered 且单 candidate
  // 2. 取 candidate 真实目录；移动到 ~/.agents/skills/<name>（已存在报错）
  // 3. 原 candidate 路径建 symlink → 新位置
  // 4. config.skillOverrides[name].managed = true；ConfigStore.write
  // 5. 触发 refresh

export async function setIgnored(config, index, skillName, ignored: boolean): Promise<void>
  // config.skillOverrides[name].ignored = ignored；ConfigStore.write
```

`~/.agents/skills` 路径从 `config.sources` 中 type=`global-dir` 的 source 取（动态，不写死）。

## utils/git.ts

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function gitClone(url, dest, opts?: { branch?: string }): Promise<void>   // execFileAsync("git", ["clone", url, dest, ...])
export async function gitPullFfOnly(dir): Promise<{ fastForward: boolean; error?: string }>   // execFileAsync("git", ["-C", dir, "pull", "--ff-only"])
```

用 node 内置 `node:child_process`（`execFile`）调系统 `git`，捕获 stderr 友好报错。**不引入 execa / isomorphic-git**（execa 未装且 `pnpm add` 受限；child_process 是 node 内置，符合现有代码全用 node 内置模块 `fs`/`crypto` 的风格）。测试用 `git init` 本地临时 repo，不联网。

## CLI 命令映射

新增/扩展（保持 cac 风格，命令内联在 `src/cli/index.ts`，或按需拆 `src/cli/commands/`）：

```txt
asm source list
asm source add <path> [--id <id>]
asm source add-repo <git-url> [--id <id>] [--branch <branch>]
asm source sync [id]
asm source remove <id> [--purge]
asm source enable <id>
asm source disable <id>

asm skill add <path> [--id <id>]       # 扩展现有 skill 命令的子命令分支
asm skill import <path> [--id <id>]
asm skill prefer <name> --source <source-id>

asm discover
asm adopt <skill>
asm ignore <skill>
asm unignore <skill>
```

## 文件清单

新增：

```txt
src/core/services/source-service.ts
src/core/services/skill-service.ts
src/core/services/discover-service.ts
src/utils/git.ts
tests/source-service.test.ts
tests/skill-service.test.ts
tests/discover-service.test.ts
tests/git.test.ts          # 用 git init 本地临时 repo，不联网
tests/skill-overrides.test.ts   # 序列化 + refresh 读 overrides
```

改动：

```txt
src/core/models/config.ts        # +SkillOverride +AppConfig.skillOverrides
src/core/storage/config-store.ts # serialize/parse +skill-overrides；+write()
src/core/services/refresh-service.ts  # mergeCandidates/calculateStatus 改读 config overrides
src/cli/index.ts                 # +source/skill扩展/discover 命令
```

## 安全与回滚

- 所有 source/skill 写操作走「read → mutate → write」，config.write 原子写。
- git clone 失败不写 config；git pull --ff-only 失败不删 repo。
- import 复制失败回滚（删已复制部分）。
- adopt 移动文件：先确保目标不存在（避免覆盖），移动失败回滚（移回原位）。原位建 symlink 前，原真实目录已移走，路径空。
- adopt 目标 `~/.agents/skills/<name>` 已存在同名 → 报错不覆盖。
- 全部测试用临时 `ASM_HOME` + 临时目录；git 测试用 `git init` 本地 repo，不联网。

## Trade-offs

- 意图层迁 config（方案 B）：比方案 A 多写序列化/parse/refresh 逻辑，但符合数据分层，意图不会被 index 重建清掉。
- adopt 物理接管：移动用户文件有风险，需严格的目标存在性检查与失败回滚；换来 agent 目录"扶正"为纯 symlink 区的干净模型。
- adopt 多 candidate 暂不支持：MVP 限定单 candidate discovered skill，多 candidate 提示先 prefer。
- git pull --ff-only：保守，复杂冲突留给用户手动处理。
