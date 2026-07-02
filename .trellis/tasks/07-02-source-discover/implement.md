# Source 管理与 Discover — 实施计划

## 执行策略

意图层迁移（config skill-overrides）是 M1/M2 的共同前置，单独作为 **M0** 先落地并测试。随后 **M1 Source 管理**、**M2 Discover** 依次实现，每个 milestone 独立可验证（typecheck + test + 临时 ASM_HOME smoke）。

不重构既有数据模型（SourceConfig / SkillCandidate / SkillRecord / InstallationRecord）。所有新增写操作必须原子写 + 临时 ASM_HOME 隔离测试。

---

## M0. 意图层迁移（前置基础）

Files:

```txt
src/core/models/config.ts
src/core/storage/config-store.ts
src/core/services/refresh-service.ts
tests/skill-overrides.test.ts
```

Tasks:

- [ ] `config.ts`：新增 `SkillOverride`（`ignored` / `managed` / `preferredSourceId` / `preferredCandidateId`）；`AppConfig` 新增 `skillOverrides: Record<string, SkillOverride>`；`createDefaultConfig()` 初始化 `{}`。
- [ ] `config-store.ts`：
  - `serializeConfig`：遍历 `skillOverrides` 输出 `[skill-overrides.<name>]` 块（仅写已设置字段）。
  - `parseConfig`：识别 `[skill-overrides.<name>]` section 填充回 `config.skillOverrides`；section 名含非法 TOML key 字符时报错。
  - 新增 `ConfigStore.write(config)`：原子写（复用 `atomicWriteFile`）。
- [ ] `refresh-service.ts`：
  - `mergeCandidates` 签名改为接收 `overrides`（从 `config.skillOverrides` 传入），不再从 previous index 读意图。
  - `calculateStatus` 加 `overrides.managed` 分支（优先级：ignored → missing → managed → conflict(no preferred) → preferred → discovered → managed）。
  - `refreshIndex` 把 `config.skillOverrides` 传给 `mergeCandidates`。
  - previous index 仍用于检测 `missing`，但不再保留意图字段来源。

Validation（M0 完成后）:

```bash
pnpm typecheck
pnpm test
# 往返：写 overrides → read → 断言一致
# refresh：discovered skill + overrides.managed=true → status=managed
```

---

## M1. Source 管理

### M1.1 git 工具

Files: `src/utils/git.ts`, `tests/git.test.ts`

- [ ] `gitClone(url, dest, opts?)`：用 node 内置 `promisify(execFile)`（`node:child_process`）执行 `git clone`（**不要 execa，不要 pnpm add**）；失败抛含 stderr 的错误。
- [ ] `gitPullFfOnly(dir)`：`execFile("git", ["-C", dir, "pull", "--ff-only"])`；返回 `{ fastForward: boolean; error?: string }`。
- [ ] 测试用 `git init` 本地临时 repo（`mktemp -d` + commit），不联网。

### M1.2 source-service

Files: `src/core/services/source-service.ts`, `tests/source-service.test.ts`

- [ ] `slugify`：path/url basename → 合法 slug；`dedupeId(config, base)` 冲突加 `-2`/`-3`；尊重 `--id`。
- [ ] `addSource(config, dir, {id?})`：校验 path 存在；生成 id；去重（同 path 已存在则 skip+提示）；`config.sources.push`；`ConfigStore.write`。
- [ ] `addRepoSource(config, url, {id?,branch?})`：先 `gitClone` 到 `repos/<slug>`；成功后注册 `git-repo` source；clone 失败不写 config。
- [ ] `syncSources(config, sourceId?)`：无 id 遍历 enabled git-repo；`repos/<id>` 不存在 → clone，存在 → pullFfOnly；返回 `SyncResult[]`；完成后提示 refresh。
- [ ] `removeSource(config, id, {purge?})`：从 config 删；`--purge` 时校验 repos 目录属于该 source 再删。
- [ ] `setSourceEnabled(config, id, enabled)`；`listSources(config)`。
- [ ] 对未知 id 报错。

### M1.3 skill-service

Files: `src/core/services/skill-service.ts`, `tests/skill-service.test.ts`

- [ ] `addSingleSkill(config, dir, {id?})`：校验 `dir/SKILL.md` 存在；注册 `single-skill` source。
- [ ] `importSkill(config, dir, {id?})`：完整目录拷贝到 `local/<name>/`；注册 `single-skill` source 指向 local 路径；失败回滚。
- [ ] `preferSkill(config, index, skillName, sourceId)`：校验 sourceId 存在且提供该 skill candidate；写 `config.skillOverrides[name].preferredSourceId`；`ConfigStore.write`。

### M1.4 CLI

Files: `src/cli/index.ts`

- [ ] `source list/add/add-repo/sync/remove/enable/disable` 子命令树。
- [ ] 扩展 `skill` 命令 action：新增 `add/import/prefer` 分支（保留 list/info）。

Validation（M1 完成后）:

```bash
ASM_HOME=<tmp> asm init
ASM_HOME=<tmp> asm source add <tmp-dir>          # config.toml 出现 [[sources]]
ASM_HOME=<tmp> asm source list
ASM_HOME=<tmp> asm source add-repo <local-repo>  # clone 到 repos/
ASM_HOME=<tmp> asm source sync                   # 已有 repo pull --ff-only
ASM_HOME=<tmp> asm source enable/disable/remove <id>
ASM_HOME=<tmp> asm skill add <tmp-skill>
ASM_HOME=<tmp> asm skill import <tmp-skill>
ASM_HOME=<tmp> asm skill prefer <name> --source <id>   # refresh 后 conflict→managed
ASM_HOME=<tmp> asm source remove <id> --purge
```

---

## M2. Discover

### M2.1 discover-service

Files: `src/core/services/discover-service.ts`, `tests/discover-service.test.ts`

- [ ] `listDiscover(index)`：纯过滤，返回四类 entry：
  - `discovered`：`index.skills` 中 status=`discovered`。
  - `conflict`：status=`conflict`。
  - `external`：`index.installations` 中 status=`external`。
  - `broken-link`：`index.installations` 中 status=`broken-link`。
- [ ] `adoptSkill(config, index, skillName)`：
  1. 校验 `status=discovered` 且单 candidate，否则报错。
  2. 取 candidate 真实目录 `src`；目标 `globalDir/<name>`（globalDir 从 config 中 type=`global-dir` 的 source path 解析）。
  3. 目标已存在 → 报错不覆盖。
  4. `fs.rename(src, dest)` 移动真身。
  5. 在 `src` 原位建 symlink → `dest`（agent 立即可用）。
  6. `config.skillOverrides[name].managed = true`；`ConfigStore.write`。
  7. 移动/建链失败回滚（rename 回去 / 删 symlink）。
- [ ] `setIgnored(config, skillName, ignored)`：写 `config.skillOverrides[name].ignored`；`ConfigStore.write`。

### M2.2 CLI

- [ ] `discover`：打印四类清单。
- [ ] `adopt <skill>` / `ignore <skill>` / `unignore <skill>`。

Validation（M2 完成后）:

```bash
ASM_HOME=<tmp> asm init
# 在 tmp agent skills_dir 手建真实目录 ~/.pi/skills/my-helper/SKILL.md
ASM_HOME=<tmp> asm refresh
ASM_HOME=<tmp> asm discover                  # 列出 discovered: my-helper
ASM_HOME=<tmp> asm adopt my-helper           # 移到 ~/.agents/skills + 原位 symlink + managed
ASM_HOME=<tmp> asm refresh
ASM_HOME=<tmp> asm skill info my-helper      # status=managed
ls -la <pi-skills>/my-helper                 # 是 symlink
ASM_HOME=<tmp> asm ignore foo
ASM_HOME=<tmp> asm unignore foo
# 多次 refresh 后 prefer/ignore/managed 不丢失
```

---

## 全局验证（task 完成前必跑）

```bash
pnpm typecheck
pnpm test
# 全部 smoke 用临时 ASM_HOME + 临时目录，不碰真实 ~/.pi/skills / ~/.agents/skills
# git 测试用本地 git init 临时 repo，不联网
```

## 回滚点

- M0 意图层迁移改了 refresh 的输入来源 —— 若测试发现 status 计算回归，先回滚 `mergeCandidates` 签名再排查。
- adopt 移动文件前必须有「目标不存在」检查；移动/建链全程 try-catch 回滚。
- git clone/pull 失败绝不动 config 或 repos 现有内容。

## Review Gate（task.py start 前）

- [ ] 用户 review prd.md / design.md / implement.md。
- [ ] 明确批准进入实现。
- [ ] implement.jsonl / check.jsonl 已 curated。
