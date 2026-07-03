# PRD: 对齐 cc-switch 的 SSOT Skill 管理

## 目标 / 用户价值

Agent Skills Mesh 需要采用严格 SSOT（Single Source of Truth）模型：skill 的真实内容集中存放在 ASM 私有 SSOT 目录 `~/.agent-skills-mesh/skills`，agent 原生 skill 目录只作为 symlink 分发视图。这样安装、启用、禁用、source 同步、更新和导入外部 skill 时，都不会出现多个真实副本互相漂移。

## 背景与证据

### cc-switch 的参考模型

- cc-switch v3.10+ 使用统一管理架构：SSOT 默认 `~/.cc-switch/skills/`，安装时下载到 SSOT，再同步到各应用目录；安装记录和启用状态存数据库（调研证据：`cc-switch services skill.rs:1-6`、`cc-switch dao skills.rs:1-7`）。
- cc-switch 支持 SSOT 位置选择：`CcSwitch` = `~/.cc-switch/skills/`，`Unified` = `~/.agents/skills/`（调研证据：`cc-switch services skill.rs:38-47`）。
- cc-switch 的 app 目录分发由 `sync_to_app_dir` 完成，支持 `Auto` / `Symlink` / `Copy`；Auto 优先 symlink，失败回退 copy（调研证据：`cc-switch services skill.rs:25-36`、`1580-1645`）。
- cc-switch 安装 GitHub skill 时把选中 skill 目录复制到 SSOT，保存 `repo_owner` / `repo_name` / `repo_branch` / `content_hash` / app enabled flags，并同步到当前 app（调研证据：`cc-switch services skill.rs:741-771`、`cc-switch dao skills.rs:106-135`）。
- cc-switch 检查更新时按 repo 分组下载远端仓库，扫描远端 skill，比较远端目录 hash 与本地 `content_hash`；更新时备份旧目录、替换 SSOT 目录、更新 DB、同步到所有 enabled app（调研证据：`cc-switch services skill.rs:873-1115`）。
- cc-switch 可以扫描 agent 目录中未管理的真实 skill，并导入到 SSOT 后建立 installed 记录（调研证据：`cc-switch commands skill.rs:100-115`、`cc-switch services skill.rs:1500-1547`）。

### skills.sh 的辅助参考

- skills.sh 使用 lock file 记录 `source` / `sourceType` / `sourceUrl` / `ref` / `skillPath` / `skillFolderHash` / timestamps，用于恢复和更新检测（调研证据：`skills.sh skill-lock.ts:15-38`）。
- skills.sh 的更新通过比较远端 folder hash 与 lock 中 hash，再重新执行 add；这说明“更新已安装 skill”需要可追踪来源和内容版本，而不仅是扫描当前目录。

### 当前 ASM 事实

- 当前默认全局 source 是 `~/.agent-skills-mesh/skills`，但 `source add-repo` 会 clone 到 `~/.agent-skills-mesh/repos/<id>`，install 直接把 agent 目录 symlink 到 candidate path（通常是 clone 仓库内的 skill 目录）（代码证据：`src/core/storage/config-store.ts`、`src/core/services/source-service.ts`、`src/core/services/install-service.ts`）。
- 当前 `applyInstallPlan` 只创建 symlink；`uninstall` 只删除 symlink，不删除真实目录（代码证据：`src/core/services/install-service.ts`）。
- 当前 `source sync` 对 `git-repo` 执行 clone 或 `git pull --ff-only`，然后要求用户手动 `asm refresh`（代码证据：`src/core/services/source-service.ts`、`src/cli/index.ts`）。
- 当前 scanner 已按 skills.sh 规则支持 configured source 的嵌套目录、plugin manifest 和 fallback；`agent-dir` / `global-dir` 保持 depth-1（代码证据：`src/core/scanners/skill-scanner.ts`、`.trellis/spec/backend/scanner-conventions.md`）。
- 当前 `SkillCandidate.id` 包含 `hash.slice(0, 12)`，如果用户持久化 `preferredCandidateId`，内容更新后 candidate id 会变化，偏好可能失效（代码证据：`src/core/scanners/skill-scanner.ts`、`src/core/services/refresh-service.ts`）。

## 需求

### R1. 严格 SSOT 不变量

ASM 管理的 installed skill 的真实内容必须位于 ASM 私有 SSOT 目录 `~/.agent-skills-mesh/skills`。agent skill 目录不得直接指向 repo clone 中的 skill 目录，也不得保留 ASM 管理 skill 的真实副本。

### R2. Source 与 Installed Store 分离

Configured source（git repo、local dir、single skill）只作为发现和更新来源；SSOT 目录是 installed store，不再作为普通 discover source 扫描。

### R3. Installed State 持久化

新增独立 state 存储，记录 installed skill 的 source metadata、SSOT path、content hash、enabled agents、installedAt、updatedAt。`config.toml` 继续保存用户配置/意图，`index.json` 继续保存可重建扫描事实。

### R4. 安装到 SSOT，再 symlink 到 agent

安装来自 source 的 skill 时，先把选中 skill 目录复制/替换到 SSOT，再在目标 agent skill 目录创建 symlink 指向 SSOT。每个 skill name 在 SSOT 中只允许一个 installed 实例。

### R5. Source sync 自动更新 installed skill

`asm source sync [id]` 成功更新 git-repo source 后，应自动检测 state 中来源于该 source 的 installed skills；若 source 目录内容 hash 变化，则安全替换 SSOT 内容并更新 state，再校验/修复 enabled agents 的 symlink。

### R6. Agent 分发严格 symlink-only

agent 目录只允许 symlink 指向 SSOT；不实现 cc-switch 的 copy fallback。symlink 创建失败应明确报错，不静默复制。

### R7. 导入/接管外部 skill

agent 目录中已有真实 skill 可被导入/接管到 SSOT；导入后原位置应变成指向 SSOT 的 symlink，不再保留独立真实副本。

### R8. 安全替换与回滚

复制/替换 SSOT 内容必须使用临时目录、备份或原子 rename；失败时不得破坏旧 SSOT 内容或已存在 agent symlink。不得覆盖真实目录或外部 symlink。

### R9. 破坏性改造可接受

版本未发布，允许破坏性调整默认 config/index/state 语义。不需要兼容旧安装 symlink、旧 default global-dir source 语义或旧 state 内容，也不需要提供迁移命令。

## 决策记录

- **SSOT 目录策略**：固定使用 ASM 私有目录 `~/.agent-skills-mesh/skills`；不支持切换到 `~/.agents/skills`。
- **Agent 分发策略**：严格 symlink-only，不支持 copy fallback。
- **Source sync 更新策略**：`source sync` 成功后自动更新相关 installed SSOT 内容。
- **SSOT 模型角色**：SSOT 是 installed store，不再作为普通 discover source。
- **Installed state 存储**：新增独立 state 存储，不写入 config 或 index。
- **同名 installed 策略**：每个 skill name 在 SSOT 中只允许一个 installed 实例。
- **迁移策略**：版本未发布，破坏性更新可接受；不做旧语义迁移命令。

## 验收标准

- [ ] AC1：安装来自 git-repo source 的 skill 后，agent 目录 symlink 指向 ASM SSOT 下的 skill 目录，而不是 `repos/<id>/...`。
- [ ] AC2：SSOT 目录不再作为普通 source candidate 出现在 `index.skills[*].candidates` 中。
- [ ] AC3：installed skill 的来源、SSOT path、content hash、enabled agents 和 timestamps 被写入独立 state，并能 round-trip。
- [ ] AC4：重复安装同一 skill 到同一 agent 为 skip；安装到第二个 agent 复用同一 SSOT 内容并新增 symlink/state enabled agent。
- [ ] AC5：`source sync` 更新 git source 后，相关 installed skill 的 SSOT 内容自动更新，state hash/updatedAt 更新，enabled agent symlink 仍指向 SSOT。
- [ ] AC6：`source sync` 遇非快进或更新冲突时不得破坏旧 SSOT 内容。
- [ ] AC7：`uninstall <skill> --agent <agent>` 只移除该 agent symlink 和 state enabled agent，不删除 SSOT 真实内容。
- [ ] AC8：agent 目录中已有真实 skill 可以被导入/接管到 SSOT；导入后原位置不再保留独立真实副本。
- [ ] AC9：多来源同名 skill 的选择在内容更新后仍稳定，不依赖含 hash 的 candidate id。
- [ ] AC10：新增或更新测试覆盖 install、uninstall、source sync auto-update、state storage、discover/adopt、conflict、rollback、安全路径。
- [ ] AC11：`pnpm typecheck` 与 `pnpm test` 通过。

## 非目标

- 不照搬 skills.sh 的完整 lock file；本任务使用 ASM state 记录 sourceId、relativePath 和 contentHash。
- 不重构已完成的 scanner skills.sh 对齐逻辑。
- 不引入 GitHub Tree API 快速更新检测；先基于本地 clone/source hash 实现。
- 不支持 copy fallback。
- 不做旧版本迁移命令。

## 设计与执行计划

- 技术设计：`design.md`
- 执行计划：`implement.md`
