# Implement: 重构 ASM CLI 命令骨架为三层模型

## 执行原则

- 版本未发布，允许破坏性调整；不提供旧命令 shim（`install`/`uninstall`/`adopt`/`import`/`prefer`/`ignore`/`discover` 全部移除或改名）。
- 自下而上：**模型/存储 → service → CLI 骨架 → TUI 适配 → 测试**。每层改完先 `pnpm typecheck` 再上推，避免错误堆积。
- 底层 state/SSOT 文件操作已由 `07-03-ssot-skill-management` 完成，本任务只精简「派生层」（index/model/refresh）和重组「表现层」（CLI/TUI）。
- 所有文件系统操作必须可用临时 `ASM_HOME` + 临时 agent dirs 测试；禁止触碰真实 home。
- CLI 只做人类可读输出；服务层 typed return。

## Review Gates（实现中依次过）

- **G1（CLI 骨架前）**：**已决策——迁移到 commander**。实测确认 cac `^6.7.14` 不支持嵌套子命令（注册 `cli.command('source add <path>')` 后输入 `asm source add foo`，`matchedCommand` 为 undefined，三个词被当成位置参数），无法满足 R8。改用 commander 原生 `.command()` 嵌套子命令，每子命令独立 option/help/校验。
- **G2（模型精简后）**：`pnpm typecheck` 通过，才进入 service 改造。
- **G3（service 改造后）**：`pnpm typecheck && pnpm test` 通过（允许 test 暂跳 TUI），才进入 CLI/TUI 重写。

## 实施清单

### 1. 模型层精简（R6 + R11）

- [ ] `src/core/models/config.ts`：删除 `SkillOverride` interface；`AppConfig` 移除 `skillOverrides` 字段；评估从 `SourceType` 移除 `"global-dir"`（SSOT 不再作为 source 扫描），保留 `"agent-dir"`（discover external 用）。
- [ ] `src/core/models/skill.ts`：`SkillRecord` 移除 `preferredCandidateId` / `preferredSourceId` / `ignored`（`supportedAgents` 暂保留）；`SkillStatus` 删除 `"ignored"`，新增 `"orphan"` → `("managed" | "orphan" | "conflict" | "discovered" | "missing")`。
- [ ] `src/core/models/index.ts`：`IndexFile` 移除 `sources` 字段（config 的纯镜像）。
- [ ] `src/core/models/installation.ts`：`InstallationRecord` 移除 `installedCandidateId`（含 hash 不稳定）；`InstallationStatus` 收敛为 symlink 健康度 `("installed" | "missing" | "broken-link" | "conflict" | "external")`，移除 `"available"` / `"unsupported"`（由 `state.enabledAgents` 推导，不写入 installations）。
- [ ] **G2：`pnpm typecheck`**（预期大量错误，全部留在步骤 2-7 修复）。

### 2. 存储层（R6 + R11）

- [ ] `src/core/storage/config-store.ts`：`createDefaultConfig` / `serializeConfig` / `parseConfig` 移除 `[skill-overrides]` 段读写与 `assertValidOverrideName` 调用。
- [ ] 更新 storage 单元测试：config round-trip 不再含 overrides；index 不再含 sources 镜像。

### 3. refresh / index 重建逻辑（R11）

- [ ] `src/core/services/refresh-service.ts`：
  - `refreshIndex` 返回值移除 `sources` 字段；`buildRefreshSources` 仍返回数组供内部扫描，但不再写回 index。
  - `mergeCandidates` / `buildSkillRecord` / `calculateStatus`：移除 `overrides` 参数；新增 orphan 计算——`state.installedSkills[name].source.kind === "configured-source"` 且 `sourceId` 不在 `config.sources` 中 → `"orphan"`，否则 `"managed"`。
  - `buildIssues`：基于新 status（含 orphan）+ installations + state 重建；新增 orphan issue kind。
- [ ] `src/core/services/install-service.ts`：`detectInstallations(config, skills, state)` 改为以 `state.enabledAgents` 为 expected target（见 design「installations 重定位」）：
  - 遍历 `state.installedSkills[name].enabledAgents[agentId]` → 期望 symlink 指向 `ssotPath`，产出 `installed`/`missing`/`broken-link`/`conflict`。
  - 遍历 agent-dir 扫描 → ASM 未纳管真实目录/外部 symlink → `external`。
  - `available` 不写入；移除对 `installedCandidateId` 的依赖。
- [ ] 验证：index 任意字段可从 (config + state + fs) 重建，删除 index.json 后 `refresh` 可完整恢复。

### 4. 两步分离更新服务层（R3）

- [ ] `src/core/services/source-service.ts`：拆分 `syncSources` 为 `sourceUpdate(configStore, stateStore, id?)`——只拉来源（git `pull --ff-only` / folder 重扫），扫描 source skills，与 `state.contentHash` 比较，输出「skill `<name>` 有新版 (oldHash → newHash)，待 `skill update`」；**不**替换 SSOT。非快进报失败，不改 SSOT。
- [ ] `src/core/services/skill-service.ts` 新增 `skillUpdate(stateStore, name | "--all")`——显式替换 SSOT（复用 `ssot-service` 安全复制/替换/回滚），更新 `state.contentHash` / `updatedAt`，校验 enabled agent symlink（缺失重建、被占用报 conflict）。
- [ ] orphan skill 调 `skillUpdate` 直接失败并提示「source 缺失，请 `source add` 或 `skill rebind`」。

### 5. source 统一入口（R2 + R4 + R5）

- [ ] `src/core/services/source-service.ts`：
  - 统一 `addSource(configStore, target, { type?, branch?, id? })`：`--type` 缺省自动推断（url→repo，含 SKILL.md 目录→skill，含子 skill 目录→folder）。废弃独立 `addRepoSource` 与「注册 source 语义的 `addSingleSkill`」。
  - `removeSource(configStore, stateStore, id, { purge })`：默认只删 `config.sources` 记录，SSOT skill 保留为孤儿（state.source 标 orphan 语义）；`--purge` 级联删 SSOT 目录 + 断所有 agent symlink + 删 state record。
  - `addSource` 成功后自动探测：对新 source 扫描结果，按 `url+branch+relativePath`（git 类）或 `contentHash`（任意类）匹配 state 中的孤儿 skill，匹配到则重写 state.source.sourceId 并提示。

### 6. skill 库服务（R5 + R6）

- [ ] `src/core/services/skill-service.ts`：
  - 新增 `skillAdd(configStore, stateStore, name, { source? })`：从 selected candidate（同名多源用 `--source`）复制进 SSOT，写 `state.installedSkills[name]`。
  - 新增 `skillRebind(stateStore, configStore, name, sourceId)`：校验目标 source 提供同名 candidate 后重写 `state.source`，恢复 update 能力。
  - 新增 `skillRemove(stateStore, name)`：删 SSOT 目录 + 断所有 agent symlink + 删 state record。
  - 移除 `importSkillToSsot`（被 `source add --type skill` + `skillAdd` 覆盖）、`preferSkill`（被 `skillAdd --source` + `skillRebind` 覆盖）。
- [ ] `src/core/services/discover-service.ts`：移除 `setIgnored`、`adoptSkill`（external 由 doctor 报告，用户清理后 `enable`）。

### 7. enable/disable（R7）

- [ ] `src/core/services/install-service.ts`：`buildInstallPlan` / `applyInstallPlan` 语义改为 `skill enable`（SSOT → agent symlink）；`buildUninstallPlan` / `applyUninstallPlan` 改为 `skill disable`（移除 symlink + 删 `state.enabledAgents[agentId]`，不删 SSOT）。函数可重命名或保留内部名，CLI 层用新动词。

### 8. CLI 骨架重写（R1 + R8，G1 已决策）

- [ ] 依赖切换：`pnpm add commander`，从 `package.json` 移除 `cac` 依赖；删除 `import { cac }`。
- [ ] `src/cli/index.ts` 用 commander 原生 `.command()` 嵌套子命令重写：
  - 顶层：`program.command('init')` / `doctor` / `tui` / `refresh`（降级，保留手动入口）。
  - source 组：`program.command('source')`，其下 `.command('add <target>')` / `.command('update [id]')` / `.command('remove <id>').option('--purge')` / `.command('list')`。
  - skill 组：`program.command('skill')`，其下 `.command('search [query]')` / `.command('add <name>').option('--source <id>')` / `list` / `info <name>` / `update <name|--all>` / `remove <name>` / `rebind <name>.option('--source <id>')` / `enable <name>.option('--agent <id>')` / `disable <name>.option('--agent <id>')`。
  - 每个子命令独立 `.option()` / `.description()` / 参数校验，对齐 `.trellis/spec/backend/quality-guidelines.md`；`asm source add --help` 只显示该子命令帮助。
- [ ] 入口改为 `program.parseAsync(process.argv)`；保留 `tui` 命令对 `process.stdout.isTTY` 的校验与 React/Ink 懒加载逻辑。
- [ ] 移除顶层 `install` / `uninstall` / `adopt` / `ignore` / `unignore` / `discover` 命令。

### 9. doctor 承担 discover（R9）

- [ ] `src/core/services/doctor-service.ts`：扩展报告 external 真实目录 / broken symlink / orphan / source-missing / conflict，并保留一键修复 fix（`refresh-index` / `repair-broken-link` / 新增 rebind 提示）。
- [ ] 移除顶层 `discover` 命令；`listDiscover` 逻辑并入 doctor 输出或保留为内部 helper。

### 10. TUI 适配（非目标：保证可编译运行）

- [ ] `src/tui/`（App 及 Matrix/Inspector 等）：适配新 `InstallationStatus`（收敛后）；移除 override/prefer/ignore 相关 cell 与交互。
- [ ] Matrix installed 判断改为读 `state.enabledAgents` + installations 健康投影。
- [ ] 不重构四屏布局（属 `07-03-tui-redesign`），仅保证现有 TUI 在新语义下可编译、快照测试更新。

### 11. 测试

- [ ] storage tests：config 无 overrides、index 无 sources 镜像 round-trip。
- [ ] refresh tests：orphan 计算、index 可重建、installations 以 state.enabledAgents 为 expected。
- [ ] source tests：`source update` 只拉来源不替换 SSOT；`skill update` 显式替换 + symlink 校验；非快进不改 SSOT。
- [ ] source add tests：三合一 `--type` 推断；孤儿自动探测重新关联。
- [ ] skill tests：`add`/`rebind`/`remove`/`enable`/`disable`；`skillUpdate` 对 orphan 失败。
- [ ] doctor tests：external/broken/orphan/source-missing/conflict 报告。
- [ ] CLI smoke（临时 `ASM_HOME` + 临时 agent dirs）：source add/update、skill add/update/remove/rebind、enable/disable、doctor。

## 验证命令

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest run
```

CLI smoke（不触碰真实 home）：

```bash
TMP=$(mktemp -d)
ASM_HOME="$TMP/asm" pnpm dev init --force
# 用临时 config/agent dirs 跑 source add/update、skill add/update/remove/rebind、enable/disable、doctor
```

## 风险与回滚点

- **cac→commander 迁移风险**：CLI 入口整体重写，需保证所有现有命令（init/refresh/doctor/tui 及新增）在新框架下行为一致；用 CLI smoke 全量回归（临时 `ASM_HOME`）。
- **installation 语义变化导致 TUI break**：步骤 10 集中适配，更新 ink-testing-library 快照；Matrix/Inspector 不动布局。
- **两步分离破坏现有 source sync**：`source update` 与 `skill update` 拆分后，旧 `sync` 自动级联行为消失（已接受，破坏性）。
- **orphan 可见性**：靠 list/info/doctor 标记 `[orphan]` 保证不变成隐藏垃圾；`skillUpdate` 失败有明确提示。
- **index 重建一致性**：refresh 是 index 唯一写入点；state 为真相源，index 与 state 冲突时以 state 为准并重建。
