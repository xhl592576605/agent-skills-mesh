# skills.sh 搜索结果接入 ASM 生命周期：最小安全设计研究

## 结论摘要

最小安全方案不是让 skills.sh 结果直接成为 `SkillCandidate`，也不是直接把远程 skill 复制到 SSOT。应新增一个 Core 编排服务，把远程结果先收敛为 GitHub 仓库身份，再完整复用现有链路：

1. 校验 skills.sh 选择项与目标 skill 重名冲突（只读）。
2. 将 `source=owner/repo` 规范化为 GitHub 仓库身份；查找并复用已有 `git-repo` source，否则调用 `addRepoSource()` 创建 source。
3. 用当前 config/state 执行 `refreshIndex()`，只在该 source 内按 **API `skillId` 与扫描后的 `candidate.skillName` 精确相等** 匹配。
4. 必须恰好命中一个 candidate，再通过 `skillAdd(..., { source: source.id })` 或抽出的 `skillAddCandidate()` 写入 SSOT/state。
5. 成功后再次 refresh 并写 `index.json`；不创建 agent symlink，`enabledAgents` 保持空对象。
6. 只有本次新建的 source 才允许补偿删除；复用 source 永远不删、不 pull、不 reset、不改 branch。

现有 `skillAdd()` 在“SSOT 复制成功、state 写失败”时会留下无 state 的 SSOT 目录，因此要满足可靠回滚，建议先把其复制/state 写入收敛成事务化 helper；仅在外层调用 `removeSource(..., { purge: true })` 不足以安全补偿。

---

## 1. 现有事实与证据

### 1.1 三层模型已经能表达 skills.sh 安装结果，无需新增持久化 source 类型

- `SourceConfig` 已有 `git-repo`、`path`、`url`、`branch`，足以保存 GitHub 来源：`src/core/models/config.ts:1-12`。
- `InstalledSkillRecord` 将 SSOT 路径、内容 hash、来源逻辑坐标及 agent 分发状态写入 state：`src/core/models/state.ts:28-41`。
- configured source 的已安装来源会保存 `sourceId/sourceType/sourcePath/relativePath/url/branch`：`src/core/models/state.ts:49-58`。
- `installedSourceFromCandidate()` 正是从 source root 与 candidate path 计算稳定 `relativePath` 的现有入口：`src/core/services/ssot-service.ts:114-126`。
- 后续 source update 按 state 中的 `sourceId + relativePath` 找回源目录并比较 hash：`src/core/services/source-service.ts:217-227`；路径定位有 containment 校验：`src/core/services/source-service.ts:230-237`。

因此 skills.sh 只是“发现服务”，不应进入 config/state schema，也不应成为第四层 registry 持久化模型。安装成功后的 state 仍然是普通 configured-source 记录。

### 1.2 source 创建已有一半事务保护，但只覆盖 `addRepoSource()` 自身

- `addRepoSource()` 当前只用 URL 字符串完全相等判断重复：`src/core/services/source-service.ts:143-146`。
- clone 目标固定在 `config.paths.repos/<sourceId>`，且目标已存在会拒绝：`src/core/services/source-service.ts:148-161`。
- 它先 clone，后写 config；clone 或 config 写失败时会清理目标：`src/core/services/source-service.ts:164-172`。
- config 写入本身使用临时文件 + rename：`src/core/storage/config-store.ts:89-92`。

但 `addRepoSource()` 返回后，后续 refresh/candidate 匹配/SSOT 写入失败不在其补偿范围内，必须由新的安装编排服务负责。

### 1.3 不应通过通用 `addSource()` 创建远程安装 source

`addSource()` 在创建 source 后还会调用孤儿自动 rebind：`src/core/services/source-service.ts:72-79`；rebind 会重写现有 installed state 的 `sourceId/relativePath/url/branch`：`src/core/services/source-service.ts:346-377`。

若 skills.sh 安装之后失败，简单删除新 source 会让这些被自动 rebind 的旧 skill 再次变成孤儿，并且无法精确恢复旧 state。最小、隔离的做法是远程安装编排直接调用已导出的 `addRepoSource()`，避免引入与“安装所选 skill”无关的孤儿 rebind 副作用。

### 1.4 refresh 与 candidate 的真实身份来自本地扫描，不来自 API

- refresh 只扫描 enabled source，并通过 `Promise.all(scanSource)` 收集 candidates：`src/core/services/refresh-service.ts:8-11`。
- candidates 按 `skillName` 分组；同名候选保留在同一 `SkillRecord.candidates` 中：`src/core/services/refresh-service.ts:43-53`。
- candidate 的 `skillName` 由 `SKILL.md` frontmatter `name` 优先决定，否则才是目录 basename：`src/core/scanners/skill-scanner.ts:134-142`。
- 本地 candidate ID 格式由 ASM 自己生成，包含 source id、skill name、relative path：`src/core/scanners/skill-scanner.ts:145-160`；它与 skills.sh API 的 `id` 没有可比较关系。
- candidate ID 在内容变化后保持稳定已有测试：`tests/skill-scanner.test.ts:57-67`。

所以不能把 API `id` 与 `candidate.id` 比较，也不能把 API `name` 直接当本地路径。API 结果只提供“应该在某 GitHub repo 中找到哪个 skill”的远程引用；clone 后扫描结果才是权威安装输入。

### 1.5 `skillAdd()` 已有正确的 source 限定与重名拒绝语义

- 写入前先检查 `state.installedSkills[name]`，已安装即 `SKILL_ALREADY_INSTALLED`：`src/core/services/skill-service.ts:80-85`。
- 它只接受仍在 config 中、origin 为 `configured-source` 的 candidate，并支持按 source id 过滤：`src/core/services/skill-service.ts:87-92`。
- 过滤后 0 个或多个都会明确报错，不会静默选一个：`src/core/services/skill-service.ts:91-92`。
- 唯一 candidate 才复制到 SSOT、创建来源记录并写 state：`src/core/services/skill-service.ts:94-101`。
- 多 source 同名冲突已有错误码测试：`tests/skill-service.test.ts:214-223`。

这意味着新服务无需发明另一套候选选择规则；只需把 API `skillId` 映射为 `name`，并强制传入解析出的 `source.id`。

### 1.6 当前 `skillAdd()` 存在需要补齐的补偿缺口

- `copySkillDirToSsot()` 自身使用 temp/rename，并能清理 temp、恢复 backup：`src/core/services/ssot-service.ts:43-84`。
- 但 `skillAdd()` 在复制完成后才读取元数据/算 hash/写 state：`src/core/services/skill-service.ts:94-101`。
- state 虽然原子写：`src/core/storage/state-store.ts:39-40`，但若 `createInstalledRecordFromCandidate()` 或 `stateStore.write()` 抛错，已创建的 SSOT 目标没有删除。

结果是“state 中未安装，但 `$ASM_HOME/skills/<name>` 已存在”；下次安装会触发 `SSOT_TARGET_EXISTS`。因此新 source 回滚不能只删除 config/clone，还必须保证 SSOT add 本身具备事务补偿。

### 1.7 `removeSource(..., purge)` 不能作为通用远程安装回滚器

- purge 会找出该 source 的 **全部** installed records：`src/core/services/source-service.ts:246-250`。
- 它会级联删除这些 skill 的 agent symlink、SSOT 和 state：`src/core/services/source-service.ts:252-264`。
- git clone 删除虽然有 repos containment 校验，但实际删除是 best-effort：`src/core/services/source-service.ts:265-274`、`src/core/services/source-service.ts:391-397`。

因此：

- 对复用 source 调 purge 会误删该仓库此前安装的全部 skills，绝对禁止。
- 对新 source，如果 state 写入尚未发生，purge 看不到遗留 SSOT，仍清不干净。
- clone 删除错误会被吞掉，不适合作为需要向 UI 报告“回滚是否完整”的事务补偿。

---

## 2. API 结果如何匹配具体 candidate

### 2.1 远程结果的信任边界

建议 Core 接收下列只读、typed 引用；即使 TUI 已过滤，安装入口仍须重新校验：

```ts
interface SkillsShSkillRef {
  provider: "skills.sh";
  id: string;       // 仅用于结果追踪/诊断，不与 ASM candidate.id 比较
  skillId: string;  // 本地候选匹配键
  name: string;     // 展示/确认信息，不作为路径或安装键
  installs: number;
  source: string;   // 必须严格为 owner/repo
}
```

校验规则：

1. `source` 严格解析为两个 GitHub path segment；拒绝协议、额外 `/`、query、fragment、反斜杠、`.`/`..` 等。
2. `skillId` 先过 `assertSafeSkillName()`；该函数跨平台拒绝分隔符、空白、控制字符、Windows 保留字符/设备名：`src/utils/safe-path.ts:4-16`。
3. clone URL 只能由 Core 从解析后的 owner/repo 构造，例如 `https://github.com/<owner>/<repo>.git`；不能使用 API 提供的任意 URL。
4. 安装阶段再次校验，不信任从弹窗返回的对象。

### 2.2 精确匹配算法

完成 source 创建/复用并 refresh 后：

```ts
const skill = refreshed.skills[ref.skillId];
const matches = (skill?.candidates ?? []).filter(
  (candidate) =>
    candidate.origin === "configured-source" &&
    candidate.sourceId === source.id &&
    candidate.skillName === ref.skillId,
);
```

- `matches.length === 1`：允许安装。
- `0`：远端索引已过期、现有 branch 不含该 skill、scanner 规则与 registry 不一致，或 API schema/语义漂移；明确报“仓库中找不到所选 skill”，提示手动添加 source。禁止改用 `name`、目录 basename、模糊匹配或抓网页兜底。
- `>1`：同一仓库出现相同 frontmatter name 的多个目录；明确报歧义，禁止静默取排序第一项。

随后调用 `skillAdd(configStore, stateStore, refreshed, ref.skillId, { source: source.id })`。现有实现会再次执行 live source、origin、0/多 candidate 校验，形成第二道保护。

为什么选 `skillId` 而非 `name`：`name` 应保留为用户可见元数据；本地安装键必须稳定且能与 scanner 的 `skillName` 对齐。若后续通过真实 API 样本证实 `skillId` 不是 skills.sh 的安装标识，应更新显式 mapping contract，而不是增加猜测式 fallback。

### 2.3 同名与大小写

- 安装前先读 state，以 `ref.skillId` 检查已安装，避免为必然失败的请求先 clone。
- refresh 后再以权威的 `candidate.skillName` 检查一次；现有 `skillAdd()` 会做该检查：`src/core/services/skill-service.ts:81-83`。
- SSOT 中存在目录但 state 不存在时，现有 `copySkillDirToSsot(..., replace:false)` 会报 `SSOT_TARGET_EXISTS`，不会覆盖：`src/core/services/ssot-service.ts:60-66`。
- 不建议在此功能中私自把 skill 名转小写。当前 state key 是精确字符串，而 macOS/Windows 文件系统可能大小写不敏感；跨大小写冲突最终必须仍由 SSOT target existence 检查拒绝。

---

## 3. GitHub 仓库复用与同仓库多 skill

### 3.1 必须新增 canonical GitHub identity，不能沿用 URL 完全相等

现有重复判断只是 `source.url === gitUrl`：`src/core/services/source-service.ts:143-146`。它无法把以下写法识别为同一仓库：

- `https://github.com/Owner/Repo`
- `https://github.com/owner/repo.git`
- `git@github.com:owner/repo.git`
- 尾随 `/` 或大小写差异

建议新增纯函数：

```ts
type GitHubRepoRef = {
  owner: string;
  repo: string;
  key: string;      // `github:${owner.toLowerCase()}/${repo.toLowerCase()}`
  cloneUrl: string; // 固定 HTTPS URL
};

parseSkillsShSource(source: string): GitHubRepoRef;
parseGitHubUrl(url: string): GitHubRepoRef | undefined;
findGitHubRepoSources(config: AppConfig, key: string): SourceConfig[];
```

复用规则：

- 0 个：`addRepoSource()` 新建，记 `sourceAction="created"`。
- 1 个：复用，记 `sourceAction="reused"`；不 clone、不 pull、不 reset、不改 URL/branch/path。
- 多个：当前配置可能因旧的 URL 精确比较产生语义重复；报 `SKILLS_SH_SOURCE_AMBIGUOUS`，不要静默选择。
- 匹配 source 若 disabled：建议报 `SKILLS_SH_SOURCE_DISABLED` 并提示先启用，避免远程安装暗改用户 intent。refresh 本身只扫描 enabled source：`src/core/services/refresh-service.ts:8-10`。
- 匹配 source 有显式 branch 时，按现有 branch 扫描；若找不到目标 candidate，报 candidate missing。不要创建第二个默认 branch source，也不要切 branch。

### 3.2 同仓库多 skill 的自然行为

首次安装仓库 A 的 skill X：创建一次 source，refresh 后只 `skillAdd(X, {source:A})`。仓库中的 Y 只是 index candidate，不进入 SSOT。

之后安装同仓库 A 的 skill Y：canonical identity 找到并复用 A，refresh 后只添加 Y。state 中 X/Y 各自保存同一 `sourceId` 与不同 `relativePath`；后续 update/remove/doctor 可沿用现有生命周期。

证据：

- source scan 可返回多个 candidates：`src/core/scanners/skill-scanner.ts:19-38`。
- `skillAdd()` 每次只写指定 `name` 的一条 state record：`src/core/services/skill-service.ts:80-101`。
- state 的 `relativePath` 是 per-skill 保存，而非 per-repo 单值：`src/core/models/state.ts:49-58`。
- source update 遍历同一 source 的全部 installed records：`src/core/services/source-service.ts:217-227`。

---

## 4. 新 source 失败回滚设计

### 4.1 分阶段执行

建议新增 `installSkillsShSkill()` Core 编排服务，按以下提交边界执行：

#### Phase 0：无副作用预检

- 校验 result/source/skillId。
- 读 config/state。
- 若 `state.installedSkills[skillId]` 已存在，直接复用 `SKILL_ALREADY_INSTALLED`；不要 clone。
- canonical 匹配已有 source，并处理 disabled/ambiguous。

#### Phase 1：解析 source ownership

返回 discriminated union：

```ts
type ResolvedInstallSource =
  | { action: "reused"; source: SourceConfig }
  | { action: "created"; source: SourceConfig; rollback: CreatedSourceToken };
```

只有 `created` token 允许补偿。创建时直接调用 `addRepoSource()`，不要调用带孤儿 rebind 的 `addSource()`。

#### Phase 2：refresh、精确匹配、SSOT add

- 用最新 config/state 执行 `refreshIndex()`。
- 只在解析出的 source id 内按 `skillId` 精确匹配，必须唯一。
- 调用事务化的 `skillAddCandidate()`；或者先增强 `skillAdd()`，让它在复制成功但 record/state 写失败时删除仅由本次创建的 SSOT target。
- 不调用 agent enable，因此返回 record 的 `enabledAgents` 应为空；`createInstalledRecordFromCandidate()` 的默认值本来就是 `{}`：`src/core/services/ssot-service.ts:87-111`。

#### Phase 3：事实提交后的 cache 更新

- SSOT + state 成功后，重新 `refreshIndex(latestConfig, latestState)` 并写 `IndexStore`，使状态从 discovered 变为 managed。
- `index.json` 是可重建 cache；如果最终 index 写失败，不应反向删除已经成功提交的 SSOT/state/source。应返回“安装成功但索引刷新失败”的 typed warning/partial result，提示重新 refresh。
- IndexStore 写入本身是原子的：`src/core/storage/index-store.ts:29-35`。

### 4.2 SSOT add 的局部事务

推荐把 `skillAdd()` 的最后部分抽成复用 helper：

```ts
async function skillAddCandidate(
  configStore: ConfigStore,
  stateStore: StateStore,
  candidate: SkillCandidate,
): Promise<InstalledSkillRecord>
```

helper 必须：

1. 重新读取 config/state，确认 source 仍存在、candidate 属于该 source、candidate path 位于 source root 内。
2. 检查同名 state 与 SSOT target；永不 replace。
3. 复制 SSOT。
4. 创建 record 并原子写 state。
5. 若第 4 步失败，仅删除第 3 步确定由本调用新建的 SSOT target，并保留原始错误；若补偿也失败，抛带原始错误与 cleanup 信息的 `SKILLS_SH_ROLLBACK_INCOMPLETE` 或通用事务错误。

这项修复最好落在通用 skill add helper，而不是只包在 skills.sh 服务外面，否则普通 `asm skill add` 仍保留相同一致性漏洞。

### 4.3 created source 的严格补偿

不建议直接调用 `removeSource(..., purge)`。新增窄用途内部 helper，例如：

```ts
interface CreatedSourceToken {
  sourceId: string;
  url: string;
  path: string;
}

rollbackCreatedRepoSource(configStore, token): Promise<void>
```

安全契约：

1. 只接收本次 `addRepoSource()` 返回后生成的 token。
2. fresh-read config，按 `sourceId + type + canonical URL + path` 核对仍是同一个 source；身份不一致时拒绝删除。
3. 只有当 SSOT/state 局部事务已确认未提交或已完整撤销后，才移除 config source 记录。
4. config 原子写成功后，校验 clone path 严格位于 `config.paths.repos` 下，再严格递归删除 clone。
5. clone 删除失败不能吞掉；返回/抛出 rollback incomplete，让 TUI 明确告知残留路径。
6. 对 `action="reused"` 永远不运行该 helper。

补偿触发范围：新 source 创建成功后，candidate 不存在、candidate 歧义、refresh 失败、SSOT/state add 失败，均应回滚新 source。复用 source 遇到同样错误时只报告错误，既有 source/path/config/state 一律保持原状。

并发说明：当前 stores 是独立 read-modify-write，没有跨 config/state/filesystem 锁。MVP 至少必须 fresh-read + token 身份校验，避免补偿误删后来被修改或复用的 source；真正跨进程事务锁可留待后续。

---

## 5. 建议新增的 typed Core 服务与错误

### 5.1 服务边界

建议至少分为两个文件/职责，均不依赖 TUI：

1. `skills-sh-service.ts`
   - 固定 endpoint、query/limit/offset、timeout/AbortSignal。
   - 校验响应 schema，过滤非 `owner/repo` 结果。
   - 返回 typed page，不格式化文本、不写 filesystem。

2. `skills-sh-install-service.ts`
   - 输入 `SkillsShSkillRef` 与 stores。
   - canonical GitHub source 匹配。
   - source create/reuse → refresh → exact candidate → SSOT add → final index refresh。
   - 管理 created-source ownership token 与补偿。

可测试性建议注入最小依赖：`fetch`/clock 或 `SkillsShClient`，以及测试时可替换的 clone 行为；生产 clone URL 始终由 owner/repo 固定构造。不要让 TUI 自己串联 `addRepoSource + refreshIndex + skillAdd`，否则事务与补偿会散落在 UI。

### 5.2 最小类型

```ts
interface SkillsShSearchInput {
  query: string;
  limit: number;
  offset: number;
  signal?: AbortSignal;
}

interface SkillsShSearchItem extends SkillsShSkillRef {
  repository: GitHubRepoRef;
  installed: boolean;
}

interface SkillsShSearchPage {
  query: string;
  searchType: string;
  items: SkillsShSearchItem[];
  count: number;
  durationMs: number;
  limit: number;
  offset: number;
  hasNext: boolean;
}

interface SkillsShInstallResult {
  record: InstalledSkillRecord;
  source: SourceConfig;
  sourceAction: "created" | "reused";
  indexUpdated: boolean;
  warnings: string[];
}
```

`installed` 可由 state 的 `installedSkills[skillId]` 投影，用于搜索结果标记；安装入口仍必须重新检查，不能依赖展示时快照。

### 5.3 建议错误码

现有错误可复用：

- `SKILL_ALREADY_INSTALLED`
- `SSOT_TARGET_EXISTS`
- `SKILL_NO_CANDIDATE` / `SKILL_MULTIPLE_CANDIDATES`（若直接沿用 `skillAdd()`）
- `INVALID_SKILL_NAME`

建议新增、需要调用方程序化分支或提供准确降级提示的错误：

- `SKILLS_SH_QUERY_TOO_SHORT`
- `SKILLS_SH_REQUEST_TIMEOUT`
- `SKILLS_SH_REQUEST_FAILED`（params 至少含 status/reason）
- `SKILLS_SH_INVALID_RESPONSE`
- `SKILLS_SH_INVALID_GITHUB_SOURCE`
- `SKILLS_SH_SOURCE_AMBIGUOUS`
- `SKILLS_SH_SOURCE_DISABLED`
- `SKILLS_SH_CANDIDATE_NOT_FOUND`
- `SKILLS_SH_CANDIDATE_AMBIGUOUS`
- `SKILLS_SH_ROLLBACK_INCOMPLETE`

如果希望错误码更少，可把 HTTP 非 2xx、timeout、schema drift 合并为 `SKILLS_SH_UNAVAILABLE`，但 params 中仍应保留 `kind`，以便测试和 UI 提示准确。candidate not found 与 ambiguous 不宜复用同一个错误，因为用户处理方式不同。

当前错误码 union 位于 `src/core/errors.ts:17-55`；新增 code 必须同步中英字典，文件注释已明确该契约：`src/core/errors.ts:13-16`。UI 通过 `formatError()` 翻译带 code 的 Error，而 core 不依赖 i18n：`src/core/errors.ts:1-10`。

---

## 6. 测试建议

### 6.1 API 搜索与 schema

建议新建 `tests/skills-sh-service.test.ts`：

1. 正常解析 `query/searchType/skills/count/duration_ms`，保留 `id/skillId/name/installs/source`。
2. 只返回严格 `owner/repo`；well-known/域名/协议 URL/多 segment/路径穿越均过滤。
3. `limit/offset/hasNext` 正确，空结果稳定返回空数组。
4. query 少于 2 字符不发请求。
5. timeout、非 2xx、JSON 非法、字段类型错误分别返回 typed error。
6. Abort 的旧请求不会覆盖较新搜索结果（Core client 可只保证 AbortSignal；防抖/请求序号可在 TUI 状态测试）。
7. installed 标记来自 state，但安装时会重新校验，覆盖搜索后状态发生变化的竞态。

### 6.2 API 结果到 candidate 的匹配

建议新建 `tests/skills-sh-install-service.test.ts`：

1. API `name` 与 `skillId` 不同，仍按 `skillId` 精确命中。
2. API `id` 与 ASM `candidate.id` 不同不影响安装。
3. 仓库中没有 `skillId`：typed not-found；禁止 basename/name 模糊 fallback。
4. 同一 source 内两个目录给出相同 frontmatter name：typed ambiguous；不安装任一个。
5. unsafe `skillId` 在 clone 前失败。
6. source 中命中的 candidate 必须为 `configured-source` 且 path containment 有效。

可复用现有 scanner 测试模式；scanner 已覆盖 frontmatter name、嵌套扫描、同名多 source 与 unsafe name：`tests/skill-scanner.test.ts:18-45`、`tests/skill-scanner.test.ts:69-87`。

### 6.3 source 复用与同仓库多 skill

1. 首次安装 X：一个 git-repo source、一个 clone、只有 X 进入 SSOT/state，Y 仍只是 discovered。
2. 再安装同 repo 的 Y：不再 clone、不新增 source；X/Y state 共享 sourceId，但 relativePath 不同。
3. HTTPS/`.git`/SSH/大小写等 URL 变体 canonical 后复用。
4. config 中已有两个 canonical 相同 source：明确 ambiguous，不选择。
5. existing source disabled：明确报错且 enabled 值不变。
6. existing source 带 branch 且目标不存在：保留 source/branch/path，不 pull、不 reset、不新建第二 source。
7. 目标 skill 已从其他 source 安装：在 clone 前 `SKILL_ALREADY_INSTALLED`。

现有 source tests 主要覆盖 local-dir、enable/remove/update：`tests/source-service.test.ts:43-100`、`tests/source-service.test.ts:102-177`；当前未见 `addRepoSource()` clone success/failure 与 URL 复用测试，这是应补的覆盖空白。

### 6.4 回滚故障注入

所有测试用临时 ASM_HOME、本地临时 git repo 或 mocked clone，禁止真实 GitHub/用户目录：

1. 新 source clone 失败：config 不变，半成品 clone 不存在（验证现有 `addRepoSource()` 合约）。
2. 新 source clone 成功但 candidate missing：config source 和 clone 均删除，state/SSOT/旧 index 不变。
3. candidate ambiguous：同上。
4. SSOT target 预先存在但无 state：拒绝覆盖；新 source/clone 回滚；预存目录内容不变。
5. 注入 `StateStore.write()` 失败：本次创建的 SSOT target 被删除，新 source/clone 回滚，state 原文件不变。
6. 注入 SSOT cleanup 失败：返回 `SKILLS_SH_ROLLBACK_INCOMPLETE`，错误中包含残留路径；不能宣称安装已完全回滚。
7. 注入 config rollback write 失败：保留 clone，避免先删 clone 后留下指向空路径的 config；报告 rollback incomplete。
8. 注入 clone 删除失败：config 已移除但明确报告残留 clone 路径。
9. 对复用 source 注入 candidate/SSOT/state 失败：source config、clone 与该 source 既有 skills 全部保留。
10. SSOT/state 已成功但最终 IndexStore 写失败：安装/source 保留，结果标记 `indexUpdated=false` 或 warning；再次 refresh 能恢复 index。
11. rollback token 身份不一致：拒绝删除，证明不会误删并发修改后的 source。

### 6.5 生命周期集成

1. 安装后 `listInstalledSkills()` 能看到记录；该函数以 state 为事实源：`src/core/services/skill-service.ts:55-72`。
2. 安装后 record `enabledAgents` 为空，所有 agent 目录均无新 symlink。
3. 后续 `skillUpdate()` 能通过 sourceId/relativePath 更新：`src/core/services/skill-service.ts:173-207`。
4. `removeSource()` 默认将其变 orphan；purge 能删除该 source 贡献的 skills，沿用现有行为测试：`tests/source-service.test.ts:152-171`。
5. refresh 后状态为 managed；source 丢失时仍由 state 投影为 orphan：`src/core/services/refresh-service.ts:12-17`、`src/core/services/refresh-service.ts:67-93`。
6. typecheck、全量 tests、中英错误字典 key 集合测试均通过。

---

## 7. 推荐的最小实现切分（供后续实现 Agent）

1. 新增 skills.sh response/search typed model 与严格 parser。
2. 新增 GitHub repo canonical identity 纯函数；同时供“搜索结果过滤”和“现有 source 复用”使用。
3. 将 `skillAdd()` 唯一 candidate 后的写入抽成事务化 `skillAddCandidate()`，补齐 SSOT/state 失败补偿；原 `skillAdd()` 继续复用它，保持 CLI 行为。
4. 新增 `skills-sh-install-service.ts` 编排 created/reused source ownership、refresh、exact match、add、最终 index refresh。
5. 新增仅限 created source token 的严格 rollback helper；不要对复用 source 调 `removeSource --purge`。
6. TUI 只消费 typed search/install 结果与错误，不自行操作 config/clone/SSOT。

该切分是最小安全边界：不改三层持久化模型、不新增 registry 配置、不自动 enable agent、不复制第二份脱离 ASM 的 skill，同时把未文档化 API 的不稳定性限制在专用 client/parser 内。
