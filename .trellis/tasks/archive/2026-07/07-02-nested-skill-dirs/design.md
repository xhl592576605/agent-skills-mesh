# Design: 扫描器对齐 skills.sh 支持嵌套 + plugin manifest

## 架构与边界

改动集中在扫描层，不触碰模型层与 refresh 聚合层：

```
src/core/scanners/
  skill-scanner.ts      ← 重构 findSkillDirs → discoverSkillDirs（priority/depth/不下钻/SKIP_DIRS/fallback）
  plugin-manifest.ts    ← 新增：getPluginSkillPaths（读 .claude-plugin/{plugin,marketplace}.json）
src/core/services/refresh-service.ts  ← 不改（scanSource 签名/返回不变）
src/core/models/                       ← 不改（SkillCandidate/SkillRecord/SourceType 不变）
```

`scanSource(source)` 对外签名与返回 `SkillCandidate[]` 不变，`refreshIndex` / `mergeCandidates` 零改动 → 聚合、状态计算、issues 全部不受影响。

## 数据流

```
scanSource(source)
  └─ root = resolve(source.path)
  └─ sourceType 分派：
       ├─ agent-dir / global-dir → flatScan(root)            [depth-1，保持现状]
       └─ git-repo / local-dir / single-skill → discoverSkillDirs(root)
            ├─ pluginPaths = getPluginSkillPaths(root)        [读 manifest]
            ├─ prioritySearchDirs = [root, root/skills,
            │     root/skills/.curated, .experimental, .system, ...pluginPaths]
            ├─ 遍历 prioritySearchDirs：
            │     walkDeep = (dir !== root && dir 不是 pluginPath)   // 容器→depth-2
            │     for child in readdir(dir) \ SKIP_DIRS:
            │         if hasSkillMd(child): add(child); continue     // 不下钻
            │         if walkDeep:
            │             for grand in readdir(child) \ SKIP_DIRS:
            │                 if hasSkillMd(grand): add(grand)        // depth-2，不再下钻
            ├─ 去重：resolved path Set
            └─ fallback：若 priority 命中 0 → findSkillDirsRecursive(root, maxDepth=5)
  └─ buildCandidate(...)  [沿用现有：frontmatter/name/hash/origin/managed]
```

## 关键策略

### priority 顺序与 walkDeep
- `prioritySearchDirs[0] = root` → **walkDeep=false**（depth-1，防 `examples/foo/SKILL.md` 噪音）。
- `root/skills` 及 `.curated/.experimental/.system` → **walkDeep=true**（depth-2，支持 `<category>/<skill>`）。
- plugin manifest 路径 → **walkDeep=false**（manifest 已指向 skill 父目录，depth-1 即可，对齐 skills.sh 注释 "plugin-manifest-declared dirs stay at depth-1"）。

### 遇 SKILL.md 不下钻
容器层发现 `child` 含 `SKILL.md` 后 `add(child)` 并 `continue`，不再进入其孙目录。depth-2 层（grand）发现后也不再下钻（最多两级）。这保证 skill 内部的 `examples/<x>/SKILL.md`、`docs/SKILL.md` 不被当作独立 skill。

### SKIP_DIRS
`const SKIP_DIRS = ["node_modules", ".git", "dist", "build", "__pycache__"]`，在 priority 遍历、fallback 递归、walkDeep 三处统一过滤。

### plugin manifest（getPluginSkillPaths）
- 读 `<root>/.claude-plugin/plugin.json`：`{ name?, skills?: string[] }`。
- 读 `<root>/.claude-plugin/marketplace.json`：`{ metadata?: { pluginRoot? }, plugins?: [{ source?, skills?, name? }] }`。
- 校验：skill/source/pluginRoot 路径须以 `./` 开头（Claude Code 约定）；`isContainedIn(resolved, root)` 防路径穿越（`..` 或绝对路径逃逸）。
- 远程 source（`{ source, repo }` 对象）跳过，只处理本地 string source。
- 返回值：每个声明 skill 的**父目录** + 每个插件基目录下的约定 `skills/`（与 skills.sh 一致），交由 priority 遍历统一发现。

### fallback 递归
priority 全空（0 candidate）时启用：`findSkillDirsRecursive(root, depth=0, maxDepth=5)`，遇 `SKILL.md` 即收录且不再下钻，SKIP_DIRS 过滤。仅作兜底，不影响 priority 命中的常规仓库。

### 去重
- **candidate 级**：scanSource 内维护 `Set<resolvedPath>`，priority + fallback 产出同 path 只入一次。
- **skill 级**：沿用 `mergeCandidates` 按 `skillName` 跨源聚合（多 candidate 一组）。

## sourceType 分派（兼容性核心）

| sourceType | 扫描方式 | 理由 |
|---|---|---|
| `git-repo` / `local-dir` / `single-skill` | discoverSkillDirs（完整 priority+plugin+fallback） | configured-source，仓库布局未知，需完整发现 |
| `agent-dir` / `global-dir` | flatScan（root depth-1） | 扁平安装目录（~/.claude/skills 等），对齐 skills.sh agent 前缀 depth-1，**零回归** |

`sourceOrigin` / `managed` 计算不变（`global-dir`→origin global-dir，`agent-dir`→agent-dir，其余→configured-source / managed）。

## 安全

- plugin manifest 路径：`./` 前缀强制 + `isContainedIn`（normalize+resolve 后必须位于 root 内），防 `../../etc/passwd` 类穿越。
- manifest JSON 解析 try/catch 静默失败（文件缺失/非法 JSON 不中断扫描），对齐 skills.sh。

## 兼容性与回归

- 模型层零改动 → index.json 结构、TUI、CLI 输出格式全部兼容。
- `agent-dir`/`global-dir` 走独立 flatScan，现有 discover/refresh 测试不回归。
- configured source 的新行为是**超集**（原来 depth-1 能发现的仍能发现，新增 depth-2/plugin/fallback）。

## Trade-offs

- **两套扫描路径**（configured 完整 vs agent/global flat）：换取 agent 安装目录零回归。统一函数 + sourceType 调参控制 walkDeep/priority，避免代码重复。
- **不做 plugin grouping 元数据**：skills.sh 给 skill 打 `pluginName`；asm `SkillRecord` 无字段，新增字段会牵动 index/TUI/CLI，超 MVP。仅用 manifest 扩展入口。
- **fallback maxDepth=5**：可能扫出意外 SKILL.md，但"遇 SKILL.md 不下钻"+ SKIP_DIRS 已控制噪音；且仅在 priority 全空时触发，可接受。

## 回滚

改动集中在 2 个文件（skill-scanner.ts 重构 + plugin-manifest.ts 新增），`git checkout src/core/scanners/` 即可完整回滚，无数据迁移、无配置格式变更。
