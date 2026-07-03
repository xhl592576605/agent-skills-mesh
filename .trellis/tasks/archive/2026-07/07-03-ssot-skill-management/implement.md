# Implement: 对齐 cc-switch 的 SSOT Skill 管理

## 执行原则

- 版本未发布，允许破坏性调整默认 config/index/state 语义。
- 先改模型与存储，再改服务，再改 CLI/TUI，最后补测试。
- 所有文件系统变更必须可用临时目录测试；禁止触碰真实 agent skill 目录。
- 保持核心服务 typed return，CLI 只做人类可读输出。

## 实施清单

### 1. 模型与存储

- [ ] 新增 `src/core/models/state.ts`：`StateFile`、`InstalledSkillRecord`、`InstalledSkillSource`、`InstalledAgentRecord`。
- [ ] 新增 `src/core/storage/state-store.ts`：读取/写入 `state.json`，使用 `atomicWriteFile()`，缺失时返回 `createEmptyState()`。
- [ ] 调整 `ConfigStore.init()`：初始化 `paths.skills` 目录；默认不再注册指向 SSOT 的 `global-dir` source。
- [ ] 调整 `AppConfig.paths` 类型、序列化和解析逻辑支持 `skills`。
- [ ] 更新 storage tests 覆盖 `state.json` round-trip、`paths.skills` 默认值。

### 2. SSOT 文件操作工具

- [ ] 新增或扩展 service/helper：复制 skill 目录到 SSOT、计算目录 hash、读取 frontmatter metadata。
- [ ] 实现安全替换：temp copy → validate `SKILL.md` → backup old → rename new → rollback on failure。
- [ ] 复用现有 `sha256File` 或新增目录 hash helper；避免重复实现散落多处。

### 3. Refresh / Index 合并

- [ ] 调整 `refreshIndex` 签名以接收 state，或新增 `refreshIndexWithState(config, state, previous)`。
- [ ] `buildRefreshSources` 不再把 SSOT 作为 `global-dir` source；仍添加 agent-dir 用于 discover external。
- [ ] 合并 source candidates 与 state installed records，确保 installed skill 即使 source 缺失仍出现在 `index.skills`。
- [ ] 调整 `detectInstallations`：expected target 来自 state record 的 `ssotPath`，而不是 selected source candidate path。
- [ ] 更新 TUI/CLI 依赖的 installation key/status 逻辑。

### 4. Install / Uninstall

- [ ] 扩展 install plan actions，支持 `copy-to-ssot` / `update-state` / `create-symlink`。
- [ ] `buildInstallPlan` 从 selected source candidate 生成 SSOT target，检查 agent path 冲突。
- [ ] `applyInstallPlan` 执行 SSOT copy、state write、agent symlink。
- [ ] `buildUninstallPlan` / `applyUninstallPlan` 改为移除 agent symlink + state.enabledAgents[agentId]，不删除 SSOT 内容。
- [ ] 确认重复 install 同 agent 为 skip；不同 agent 安装同 skill 只新增 enabled agent 和 symlink。

### 5. Source sync 自动更新

- [ ] 调整 `syncSources` 或 CLI orchestration：sync 成功后查 state 中来源于该 source 的 installed skills。
- [ ] 对每个 installed skill 用 `source.path + relativePath` 定位最新目录并计算 hash。
- [ ] hash 不同则安全替换 SSOT、更新 state metadata/hash/updatedAt。
- [ ] 校验/修复 enabled agent symlink；被真实目录/外部 symlink 占用时报告 conflict，不覆盖。
- [ ] CLI 输出 sync 结果 + updated/skipped/conflict 汇总。

### 6. Import / Adopt / Discover

- [ ] 调整 `adoptSkill`：不再依赖 global-dir source，不写 `managed` override；改为导入到 SSOT state 并 symlink 回原 agent path。
- [ ] 调整 `skill import`：作为 installed import，复制到 SSOT state；若仍需要 source import，则明确命令文案或保留 `source add`。
- [ ] `discover` 继续列出 agent-dir real dir / external symlink / broken-link / source conflict。
- [ ] `ignore/unignore/prefer` 保留 config override，但 `managed` override 逐步废弃或不再生成。

### 7. CLI / TUI 更新

- [ ] `loadStores()` 加载 `StateStore`。
- [ ] 所有调用 `refreshIndex`、`buildInstallPlan`、`applyInstallPlan` 的命令传入 state。
- [ ] `skill info` 输出 installed state / SSOT path / enabled agents。
- [ ] Matrix/Inspector 确认不把 SSOT 作为 candidate 展示。

### 8. 测试

- [ ] state-store 单元测试：init/read/write/atomic behavior。
- [ ] install-service 测试：安装从 source 复制到 SSOT，agent symlink 指向 SSOT；重复安装 skip；第二 agent 安装复用 SSOT。
- [ ] uninstall 测试：只删除 agent symlink，不删除 SSOT；state enabledAgents 更新。
- [ ] source sync 测试：local git repo 更新后 `source sync` 自动替换 SSOT；非快进不更新。
- [ ] discover/adopt 测试：真实 agent dir 导入 SSOT 并 symlink 回原路径。
- [ ] refresh 测试：SSOT 不作为 source candidate；installed skill source 缺失仍可显示并产生 issue。
- [ ] TUI reducer/component 测试按需要更新。

## 验证命令

```bash
pnpm typecheck
pnpm test
```

CLI smoke（使用临时目录，不触碰真实 home）：

```bash
TMP=$(mktemp -d)
ASM_HOME="$TMP/asm" pnpm build
# 使用临时 config/agent dirs 跑 init/source add-repo/refresh/install/source sync/uninstall/doctor
```

## 风险与回滚点

- **状态分层风险**：config/index/state 三者不一致。缓解：StateStore typed API + refresh 统一投影。
- **文件替换风险**：更新 SSOT 时损坏旧内容。缓解：temp copy + backup + rollback。
- **TUI 状态风险**：新增/调整 status 后 cell 显示错误。缓解：组件测试 + matrix 快照。
- **source sync 自动更新风险**：同步时改变 agent 行为。缓解：CLI 输出明确列出 updated skills，失败不部分覆盖。
- **旧语义破坏**：已接受；版本未发布，不做迁移。
