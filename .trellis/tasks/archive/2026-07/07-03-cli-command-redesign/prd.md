# PRD: 重构 ASM CLI 命令骨架为三层模型

## 目标 / 用户价值

将 ASM CLI 从当前「顶层命令 + `skill`/`source` 字符串子命令」的混合结构，重构为与概念域对齐的**三层命令骨架**：Source（来源）/ Skill 库（SSOT 纳管）/ Agent 启用（symlink 分发）。让每条命令只作用于一个概念层，消除命名误导、入口重叠和位置割裂，使命令体系直接对应「ASM 是一个 skill 管理器」的心智模型。

## 背景与证据

### 当前命令冗余分析（2026-07-03 会话）

- 三种「加入 skill 来源」入口语义模糊：`source add`（local-dir）、`source add-repo`（git）、`skill add`（实际注册 single-skill source）。面对同一本地目录，用户不知该用哪个（代码证据：`src/cli/index.ts:153-165`、`79-83`）。
- 两种「导入到 SSOT」入口重叠：`skill import <path>`（`importSkillToSsot`）与 `adopt <skill>`（接管 agent 目录真实目录）都是「真实目录→SSOT」，只是输入来源不同（`src/cli/index.ts:87-91`、`223-228`）。
- `install` / `uninstall` 对象是 skill 却放在顶层，与 `skill` 组割裂（`src/cli/index.ts:109-133`）。
- `discover` / `adopt` / `ignore` / `unignore` 全在顶层，与 skill 生命周期分离；`prefer`（同属 override）却进了 skill 组，分组不一致。
- `skill <sub>` / `source <sub>` 用手动 `if/else` 字符串分发，而非 commander 原生子命令，导致 option 签名堆在外层、help 混乱、spec 与实现签名分叉（`src/cli/index.ts:38-108`、`135-211`；spec `.trellis/spec/backend/quality-guidelines.md` 写的是原生子命令格式）。

### 用户确认的三层心智模型

ASM 本质是 skill 管理器，分三层：
1. **Source**：remote 来源（git repo / 多 skill folder / 单 skill folder），负责发现与更新来源。
2. **Skill 库（SSOT）**：从 source 纳管到 `~/.agent-skills-mesh/skills` 的真实内容，唯一副本。
3. **Agent 启用**：通过 symlink 把 SSOT skill 分发到各 ai agent 的 skill 目录。

## 需求

### R1. 三层命令骨架

命令按 Source / Skill 库 / Agent 启用 三层组织，每条命令只作用于一层。顶层仅保留生命周期命令（`init`/`doctor`/`tui`）+ `source` + `skill` 两个命令组。

### R2. source 统一入口

`source add <url|path> [--type repo|folder|skill] [--branch <b>] [--id <id>]` 统一三类来源注册。废弃独立的 `source add-repo` 和「注册 source 语义的 `skill add`」。`--type` 缺省时自动推断（url→repo，含 SKILL.md 目录→skill，含子 skill 目录→folder）。

### R3. 两步分离更新

- `source update [id]`：只拉取/重扫来源（git `pull --ff-only` / folder 重扫），报告哪些已纳管 skill 有新版（contentHash 变化），**不**自动替换 SSOT 内容。
- `skill update <name|--all>`：显式把 SSOT 内容更新到 source 最新版。更新后 agent symlink 自动保持指向 SSOT。
- source 拉新版不立即改变 agent 行为；更新动作显式、可控。

### R4. source remove 默认保留 + 孤儿管理

- `source remove <id>`：默认只删 source 注册记录，保留其贡献的 SSOT skill（内容、agent symlink 不变）。这些 skill 变为「孤儿」（source 缺失）。
- `source remove <id> --purge`：级联删除该 source 贡献的 SSOT skill + 断开所有 agent symlink。
- 孤儿 skill 仍可 enable/disable，但 `skill update` 失败；`skill info` / `skill list` 标记 `[orphan]`；`doctor` 报告孤儿并建议 rebind/remove。

### R5. 孤儿重新关联

- `source add` 时自动探测：新 source 扫描后，对 state 中 source 缺失的孤儿 skill，按 `url+relativePath`（git 类）或 `contentHash`（任意类）匹配，匹配到则自动重新关联并提示。
- `skill rebind <name> --source <id>`：显式把孤儿或任意 skill 关联到新 source（校验该 source 提供同名 candidate）。

### R6. 去除冗余命令

- 去掉 `skill import <path>`：被 `source add --type skill` + `skill add` 覆盖。agent 目录 external 真实目录由 doctor 报告，用户清理后 enable。
- 去掉 `skill prefer`：被 `skill add --source`（初始选定）+ `skill rebind --source`（换源）覆盖。
- 去掉 `skill ignore` / `unignore`：靠 `skill search <query>` 过滤噪音。
- 去掉 `[skill-overrides]` config 段：config 回归纯 `sources`/`agents`/`paths` 意图，事实全在 state。

### R7. install/uninstall → skill enable/disable

- `skill enable <name> --agent <id>`：在 agent skill 目录建 symlink 指向 SSOT。
- `skill disable <name> --agent <id>`：移除 symlink（不删 SSOT 内容）。
- 语义从「安装」改为「启用」，更贴合 symlink 分发本质。

### R8. commander 原生子命令

`source` / `skill` 改用 commander 原生 `.command()` 嵌套子命令，每个子命令独立 help/option/参数校验。对齐 spec `quality-guidelines.md` 的签名格式。

### R9. doctor 承担 discover 职责

`doctor` 报告 agent 目录 external 真实目录、broken symlink、孤儿 skill、source-missing、conflict 等健康问题。去掉独立的 `discover` 顶层命令。

### R10. 与 SSOT 任务的衔接

`07-03-ssot-skill-management` 已归档完成，底层机制就绪：state 模型（`InstalledSkillRecord` / Source 逻辑坐标）、SSOT 文件操作（安全复制/替换/回滚）。本任务在其基础上重组 CLI 并精简派生层，不再等待并行。

### R11. 存储三层定位与 index 瘦身

明确 `config.toml` / `state.json` / `index.json` 的职责边界，消除 SSOT 任务后残留的重叠：

- **config.toml**：纯用户意图（settings / paths / sources / agents）。删除 `[skill-overrides]` 后即无冗余，本任务不再增删其字段。
- **state.json**：SSOT 管理事实，唯一真相源（installed skill 的 ssotPath / source / contentHash / enabledAgents / timestamps）。
- **index.json**：refresh 派生的**可重建缓存**，不是事实源；任何字段都能从 (config + state + 文件系统) 重建，写入一律以 state 为准。

index.json 温和瘦身：

- 删除 `index.sources`（config.sources 的纯镜像，需要时从 config 实时构造）。
- 删除 `SkillRecord` 的 override 派生字段（`preferredSourceId` / `preferredCandidateId` / `ignored`），随 R6 的 `[skill-overrides]` 一并消失。
- `SkillStatus` 删除 `ignored`，新增 `orphan`（installed skill 的 source 已从 config 移除，仍可 enable/disable 但 `skill update` 失败）。
- `index.installations` 重新定位为「state.enabledAgents 的 symlink 健康投影」：status 只表达 symlink 健康度（installed / missing / broken-link / conflict / external），不再表达「是否 enabled」——enabled 由 `state.enabledAgents` 决定。
- `index.issues` 保留为派生缓存，refresh 时重建。

## 决策记录

- **三层模型**：Source / Skill 库 / Agent 启用，命令按层组织。
- **source 统一**：`source add --type` 三合一。
- **更新两步分离**：`source update` 与 `skill update` 解耦。
- **remove 默认保留**：孤儿机制 + rebind 重新关联。
- **去掉 import/prefer/ignore**：精简 skill 组，移除 skill-overrides。
- **enable/disable**：install/uninstall 改名并收进 skill 组。
- **commander 原生子命令**：修复 spec 与实现分叉。
- **discover 并入 doctor**。
- **存储三层定位**：config=意图、state=事实、index=可重建缓存；写入以 state 为准。
- **index 温和瘦身**：删 `index.sources` 镜像与 override 派生字段；installations 重定位为 symlink 健康投影；`orphan` 作为 `SkillStatus`。

## 验收标准

- [ ] AC1：`source add <url|path> [--type]` 统一注册三类来源并自动推断 type；`source add-repo` 与「注册 source 的 skill add」不再存在。
- [ ] AC2：`source update [id]` 只更新来源并报告可更新 skill，不自动改 SSOT；`skill update <name|--all>` 显式更新 SSOT 内容且 agent symlink 保持。
- [ ] AC3：`source remove <id>` 默认保留 SSOT skill（孤儿），`--purge` 级联删除；孤儿在 list/info/doctor 正确标记。
- [ ] AC4：`source add` 自动探测并重新关联匹配的孤儿 skill；`skill rebind --source` 显式关联。
- [ ] AC5：`skill import` / `skill prefer` / `skill ignore` 命令移除；`[skill-overrides]` config 段移除。
- [ ] AC6：`skill enable/disable <name> --agent <id>` 替代顶层 install/uninstall。
- [ ] AC7：`source` / `skill` 使用 commander 原生子命令，每子命令独立 help/校验，与 spec 签名一致。
- [ ] AC8：`doctor` 报告 external/broken/orphan/source-missing/conflict；`discover` 命令移除。
- [ ] AC9：`pnpm typecheck` 与 `pnpm test` 通过；新增/更新测试覆盖新命令骨架、孤儿标记、rebind、两步更新。
- [ ] AC10：CLI smoke（临时 `ASM_HOME` + 临时 agent dirs）覆盖 source add/update、skill add/update/remove/rebind、enable/disable、doctor。
- [ ] AC11：`index.sources` 镜像删除；`SkillRecord` 不再含 `preferredSourceId`/`preferredCandidateId`/`ignored`；`SkillStatus` 含 `orphan`、不含 `ignored`；orphan 在 list/info/doctor 正确标记且 `skill update` 失败。
- [ ] AC12：`index.installations` 的 status 只表达 symlink 健康度，enabled 状态来自 `state.enabledAgents`；index 任意字段可从 (config+state+fs) 重建且不丢失 SSOT 真相。

## 非目标

- 不重新设计 scanner 的发现规则（已在 `07-02-nested-skill-dirs` 完成）。
- 不重构 SSOT 文件操作与 state 写入逻辑（已由 `07-03-ssot-skill-management` 完成）；本任务在其基础上精简 index/model/refresh 的派生层。
- 不取消 index.json 落盘（保留为可重建缓存，仅做温和瘦身）。
- 不做旧命令的向后兼容 shim（版本未发布，破坏性可接受）。
- 不引入 TUI 重构；TUI 四屏对齐由独立任务 `07-03-tui-redesign` 承担。本任务仅保证现有 Matrix/Inspector 在新 installation 语义下可编译运行。

## 关联任务

- 前置（已完成）：`07-03-ssot-skill-management`（底层 state/SSOT 机制）。
- 衍生：`07-03-tui-redesign`（TUI 四屏对齐，依赖本任务命令骨架）。
- 设计：`design.md`；执行计划：`implement.md`（实现前补齐）。
