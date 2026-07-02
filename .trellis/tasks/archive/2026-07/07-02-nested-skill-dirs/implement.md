# Implement: 扫描器对齐 skills.sh

## 前置确认（execute 时定位）
- 现有 scanner 测试位置：`find tests -path '*scann*'`（推测 `tests/core/scanners/` 或 `tests/scanners/`），新测试就近放置。
- `single-skill` source 当前扫描行为（addSingleSkill 产生的 source）→ 确认归入 configured-source 完整发现分支，还是保持单文件直读。

## 有序 Checklist

### 1. 新增 plugin-manifest.ts
- [ ] 创建 `src/core/scanners/plugin-manifest.ts`，实现 `getPluginSkillPaths(root: string): Promise<string[]>`。
- [ ] 类型：`PluginManifest { name?; skills?: string[] }`、`MarketplaceManifest { metadata?: { pluginRoot? }; plugins?: PluginEntry[] }`、`PluginEntry { source?: string | { source; repo? }; skills?: string[]; name? }`。
- [ ] 校验：`isValidRelativePath`（`./` 前缀）+ `isContainedIn`（normalize/resolve 防穿越）。
- [ ] 先试 `marketplace.json`（pluginRoot + 每个 plugin.source/skills），再试 `plugin.json`（根级 skills）。
- [ ] 返回：声明 skill 的父目录 + 各 pluginBase 下的约定 `skills/` 目录。
- [ ] 文件缺失/非法 JSON → try/catch 静默返回空。

### 2. 重构 skill-scanner.ts
- [ ] 顶部加 `const SKIP_DIRS = ["node_modules",".git","dist","build","__pycache__"]`。
- [ ] 保留 `hasSkillMd` / `buildCandidate` / `sourceOrigin` 不变。
- [ ] 新增 `flatScan(root)`：仅 root 直接子目录含 SKILL.md 即收录（agent-dir/global-dir 用）。
- [ ] 新增 `discoverSkillDirs(root)`：按 design 的 priority + walkDeep + 不下钻 + SKIP_DIRS + fallback(maxDepth=5) 实现；内部 path Set 去重。
- [ ] 改 `findSkillDirs`：保留为 fallback 递归实现（maxDepth=5，遇 SKILL.md 不下钻，SKIP_DIRS 过滤）。
- [ ] 改 `scanSource`：按 `source.type` 分派——`agent-dir`/`global-dir` → flatScan；其余 → discoverSkillDirs。

### 3. 单元测试
- [ ] depth-2：fixture `skills/<cat>/<skill>/SKILL.md` 被发现。
- [ ] 不下钻：`skills/<cat>/<skill>/examples/foo/SKILL.md` 不产生独立 candidate。
- [ ] SKIP_DIRS：`node_modules/x/SKILL.md` 等被跳过。
- [ ] plugin manifest：`.claude-plugin/plugin.json` 声明 skill 被发现；缺 `./` 前缀、`..` 逃逸条目被忽略。
- [ ] fallback：无 `skills/` 无 manifest 时 ≤5 层 SKILL.md 被发现。
- [ ] priority 顺序：root depth-1 不误扫 `examples/foo/SKILL.md`。
- [ ] agent-dir/global-dir：flatScan 行为不变（回归保护）。
- [ ] 去重：priority + fallback 同 path 只入一次。

### 4. 质量门
- [ ] `pnpm typecheck` 通过。
- [ ] `pnpm test` 全绿（含原有 scanner/refresh/discover 测试）。

### 5. 端到端验证（mattpocock）
- [ ] `rm -rf ~/.agent-skills-mesh && pnpm dev init`
- [ ] `pnpm dev source add-repo git@github.com:mattpocock/skills.git`
- [ ] `pnpm dev refresh`
- [ ] `pnpm dev skill list` → 期望出现 engineering/tdd、productivity/grill-me 等（manifest 20 + 目录扫描额外项）。
- [ ] 数量与仓库实际 `<category>/<skill>/SKILL.md` 数一致（抽查几个）。

## 验证命令
```bash
pnpm typecheck
pnpm test
# 端到端
rm -rf ~/.agent-skills-mesh && pnpm dev init \
  && pnpm dev source add-repo git@github.com:mattpocock/skills.git \
  && pnpm dev refresh && pnpm dev skill list
```

## 风险与回滚点
- **核心风险**：depth-2 + fallback 在某些仓库扫出意外 SKILL.md（噪音）。缓解：遇 SKILL.md 不下钻 + SKIP_DIRS + fallback 仅在 priority 全空触发。
- **回滚点**：改动集中在 `src/core/scanners/`，`git checkout -- src/core/scanners/` 完整回滚；无 index/config 格式变更，已索引数据无需迁移。

## 完成定义
- AC1–AC7 全部满足；typecheck + test 全绿；mattpocock 端到端索引数量正确；spec（.trellis/spec/backend）按需补充扫描约定。
