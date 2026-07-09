# 跨平台兼容性修复（Windows/Linux）

> **V2 — junction 方案**（替代 V1 的 symlink+copy 回退）。Windows 用 junction（无需特权），Linux/macOS 用 symlink，统一为「软连接」分发，撤销 copy 回退。

## Goal

让 `asm` 在 **Windows（普通用户权限，非管理员 / 未开「开发者模式」）** 与 **Linux** 上核心链路（init / refresh / source add / skill add / skill enable / doctor / tui）可用。Windows 采用 **junction**（无需特权）、Linux/macOS 用 symlink，统一为「软连接」分发；修复路径大小写误判、skill 名 Windows 非法字符、Windows locale 检测缺失。

本机为 macOS，无法真机验证 Windows/Linux，故以 **单元测试（mock `process.platform` / `fs`）** 为保证手段；真机烟测与 CI 矩阵留作后续任务。

## Background

### 跨平台静态审查结论（2026-07-09）

产品核心是 **软连接分发**（SSOT → agent `skills_dir`）。审查发现 Windows 风险高、Linux 风险低：

| # | 问题 | 严重度 | 根因位置 |
|---|---|---|---|
| P0-1 | symlink 创建用 `"dir"` 类型，Windows 普通用户 `EPERM` | P0 | `src/core/services/ssot-service.ts:135`(`ensureSymlinkToSsot`)、`~218`(`replaceSymlinkToSsot`)、`src/core/services/install-service.ts:120`(`applyInstallPlan`) |
| P0-2 | `samePath` 大小写敏感比较，Windows/macOS 误报 conflict/external | P0 | `src/core/services/ssot-service.ts` `samePath` |
| P1-3 | skill 名校验缺 Windows 非法字符（`< > : " \| ? *` 及保留名） | P1 | `src/utils/safe-path.ts:3` `INVALID_SKILL_NAME` |
| P2-4 | Windows 上 locale 检测恒为 `en` | P2 | `src/i18n/index.ts` `detectSystemLocale`/`detectMacOSLanguage` |

### junction 方案（V2，替代 V1 copy 回退）

- Node.js `fs.symlink(target, path, type)`：Windows 上 `"dir"` = directory symbolic link（**需特权**），`"junction"` = junction point（**无需特权**，只指目录绝对路径）；POSIX 上 `type` 被忽略。
- libuv 把 junction 识别为 symlink（`lstat.isSymbolicLink() === true`），`readlink` 可读目标（可能带 `\\?\` 前缀，需规范化）。
- **采纳 junction(Win) / symlink_dir(POSIX) 统一软连接，撤销 copy 回退** —— 无需 `syncMethod` / copy 副本 / re-copy / uninstall 三重保护那套复杂逻辑。
- 可行性验证：创建无需特权 ✅、isSymbolicLink ✅、readlink 需 `\\?\` 规范化 ⚠️（Windows 真机最终验证）。

### 已确认产品决策

- **P0-1 方案**：junction(Win) / symlink(POSIX) 统一软连接，**撤销 copy 回退**，不新增 `syncMethod` / 配置档。
- **MVP 范围**：P0-1 + P0-2 + P1-3 + P2-4，配单元测试，不依赖真机。

## Requirements

### R1 — 跨平台软连接（P0-1，junction 方案）

- **R1.1** 新增 `createSymlink(targetPath, sourcePath)`（`src/utils/fs.ts`）：`process.platform === "win32"` 用 `fs.symlink(source, target, "junction")`；否则 `fs.symlink(source, target, "dir")`。**无 copy 回退**。
- **R1.2** `applyInstallPlan` / `ensureSymlinkToSsot` / `replaceSymlinkToSsot` 改用 `createSymlink`。
- **R1.3** readlink 消费处（`detectInstallation` / `ensureSymlinkToSsot` / `buildInstallPlan`）用 `normalizeLinkTarget` 规范化 `\\?\` 前缀（strip `\\?\` 与 `\\?\UNC\`）。
- **R1.4** 撤销 V1 的 copy 相关逻辑：移除 `InstalledAgentRecord.syncMethod`、`LinkMethod`、`createLink` 回退、`allowFallback`、detect copy 识别、uninstall copy 三重保护、skillUpdate re-copy；`install_strategy` 还原 `"symlink"`。

### R2 — samePath 大小写规范化（P0-2）

- **R2.1** `samePath`（`ssot-service.ts`）按平台比较：`win32`/`darwin` 下 `path.resolve` 后 `toLowerCase()` 比较；`linux` 保持大小写敏感。
- **R2.2** 不影响 `assertPathInside` 等基于 `path.relative` 的安全校验。

### R3 — skill 名 Windows 非法字符校验（P1-3）

- **R3.1** `INVALID_SKILL_NAME`（`safe-path.ts`）增加 Windows 保留字符 `< > : " | ? *`；新增 Windows 保留名检测（`CON`/`PRN`/`AUX`/`NUL`/`COM1-9`/`LPT1-9`，大小写不敏感）。
- **R3.2** 校验失败抛 `bizError("INVALID_SKILL_NAME", {name}, ...)`；`errors.ts` 加 code + en/zh 字典同步。
- **R3.3** 跨平台一致（Windows-strictest），保证 SSOT 目录名全平台合法。

### R4 — Windows locale 检测（P2-4）

- **R4.1** `detectSystemLocale`（`i18n/index.ts`）在 `LANG` 之后、macOS `AppleLanguages` 之前，补充 `Intl.DateTimeFormat().resolvedOptions().locale`。
- **R4.2** 优先级：`LC_ALL`/`LC_MESSAGES` > `LANG` > `Intl` > macOS `AppleLanguages` > `en`。

## Out of Scope

- **copy 回退 / `SyncMethod` 三档配置**（V1 已撤销；cc-switch 的 Auto/Symlink/Copy 不采纳）。
- **P2-5** launcher 信号转发、**P2-6** git `execFile` Windows `git.cmd`、**P2-7** standalone Windows exe 构建、**P3-8** OpenTUI TUI Windows 终端兼容性 —— 需 CI/真机，单独立任务。
- skill name `slugify` 规范化 —— MVP 拒绝策略，slugify 留后续增强。
- 真机烟测 / Windows+Linux CI 矩阵 —— 后续任务。

## Acceptance Criteria

- [ ] **AC1** `createSymlink` 平台分支单测：`win32` → 调 `fs.symlink(..., "junction")`；POSIX → `fs.symlink(..., "dir")`。
- [ ] **AC2** `normalizeLinkTarget` 单测：`\\?\C:\x` → `C:\x`；`\\?\UNC\host\share` → `\\host\share`；无前缀不变。
- [ ] **AC3** `detectInstallation` 对 junction 识别 `installed`（mock `isSymbolicLink` + readlink 返回带 `\\?\` 前缀 → 规范化后 samePath 匹配）。
- [ ] **AC4** `samePath`：`win32`/`darwin` 大小写不敏感；`linux` 敏感。
- [ ] **AC5** `assertSafeSkillName`：含 `:`/`<`/`*`/保留名 `CON` → 抛 `bizError`（`INVALID_SKILL_NAME`）；合法名通过；字典完整性 test 通过。
- [ ] **AC6** `detectSystemLocale`：mock 无 `$LANG` + `Intl` 返回 `zh-CN` → `zh-CN`。
- [ ] **AC7** `bun run typecheck` 通过；`bun run test` 全绿；不引入 core 回归（install/uninstall/doctor/skill add/skill update）。
- [ ] **AC8** macOS 烟测：`init` / `doctor` / `--lang zh` 正常。

## Open Questions

- **OQ1** `readlink` 对 junction 的确切返回格式需 Windows 真机验证；若带 `\\?\` 前缀，`normalizeLinkTarget` 已覆盖。
- **OQ2** skill name slugify 规范化（displayName 保留、目录名 slug）—— 后续增强，MVP 先拒绝。
